#!/usr/bin/env bash
# B30 OS-network egress fixture (ADR-010 deployment gate). Run only inside an
# isolated, disposable WSL2 Ubuntu distribution as root, under narrow permission that
# allows operations ONLY inside newly created disposable namespaces.
#
# It never mutates the WSL initial/host namespace: every veth pair is created inside an
# already-created disposable namespace (`ip netns exec <ns> ip link add ...`), and only
# the peer is moved to the other compartment. No host address, route, link or firewall
# is assigned, and `ip link add` never runs in the initial namespace.
#
# Safety: namespaces use a unique per-run suffix; the script tracks exactly which
# namespaces it created and tears down only those; it refuses a name collision without
# touching the pre-existing object; it fails (nonzero) on any partially failed `ip`
# configuration; and teardown reports a failed `ip netns del` or an unreadable namespace
# inventory with the owned-name inventory on every exit path. The EXIT trap forces a
# nonzero process status when cleanup or inventory verification is uncertain (Bash keeps
# an already-decided `exit 0` otherwise), so a run never reports success with unresolved
# owned namespaces. Ownership is cleared only after every owned namespace is confirmed
# gone; otherwise manual reconciliation is required and never claimed complete.
#
# This is a deployment observation, not a unit test. It does not contact a provider or
# the Internet; all probes target private or TEST-NET addresses that fail locally.
# `-e` is intentionally omitted: every configuration command below carries an explicit
# `|| fail`, while the read-only routing/socket probes legitimately return nonzero for
# denied destinations. `-u` catches unset variables and `pipefail` surfaces pipeline errors.
set -uo pipefail

SUFFIX="$(date +%s)$$$RANDOM"
WORKER_NS="b30-worker-$SUFFIX"
RELAY_NS="b30-relay-$SUFFIX"
GATEWAY_NS="b30-gw-$SUFFIX"
# Link names live inside freshly created (empty) namespaces, so no collision is possible.
LINK_W="b30-w"    # worker side (moved into worker ns)
LINK_R="b30-r"    # relay worker-facing side (stays in relay ns)
LINK_R2="b30-r2"  # relay gateway-facing side (stays in relay ns)
LINK_G="b30-g"    # gateway side (moved into gateway ns)
RELAY_IP="10.100.1.1"
WORKER_IP="10.100.1.2"
GATEWAY_IP="10.100.2.1"
RELAY_GW_IP="10.100.2.2"
INTERNET_V4="192.0.2.1"       # TEST-NET-1, never routed
INTERNET_V6="2001:db8::1"     # IPv6 documentation prefix, never routed
DNS_PROBE_HOST="b30-dns-probe.invalid"   # RFC 2606 .invalid TLD, never resolvable

LOG="${B30_LOG:-/tmp/b30-egress.log}"
OUT="${B30_OUT:-/tmp/b30-egress-out.txt}"
RELAY_PORT=18081
GATEWAY_PORT=18082
FORBIDDEN_PORT=18099
# Unprivileged worker identity: the worker compartment runs probes as `nobody` with
# no_new_privs and no NET_ADMIN/SYS_ADMIN (ADR-010 requires removing network-admin
# capabilities from the worker). Root is used only for trusted setup/teardown.
WORKER_UID=65534
WORKER_GID=65534
UNPRIV="setpriv --reuid=$WORKER_UID --regid=$WORKER_GID --clear-groups --no-new-privs --bounding-set=-net_admin,-sys_admin"

# Ownership tracking: only namespaces in this array are ever deleted. LEFTOVER_NS holds
# the inventory of owned namespaces whose deletion failed or whose absence could not be
# confirmed (requiring manual reconciliation). CREATED_NS is cleared only after every
# owned namespace is confirmed gone.
CREATED_NS=()
LEFTOVER_NS=()
relay_pid=""
gateway_pid=""
forbidden_pid=""

# Returns 0 if the namespace exists, 1 if it is confirmed absent, 2 if the namespace
# inventory is unreadable (uncertain). Callers must distinguish 1 from 2.
namespace_exists() {
  local list
  if ! list=$(ip netns list 2>/dev/null); then
    echo "WARNING: cannot read namespace inventory (ip netns list failed)" >&2
    return 2
  fi
  if printf '%s\n' "$list" | awk '{print $1}' | grep -qxF "$1"; then
    return 0
  fi
  return 1
}

# Creates a namespace or refuses. Returns nonzero on collision/failure/uncertainty
# WITHOUT touching pre-existing state; the caller decides whether to fail.
create_ns() {
  local name="$1" state
  namespace_exists "$name"
  state=$?
  if [ "$state" = "0" ]; then
    echo "refusing: namespace '$name' already exists (no pre-existing state touched)" >&2
    return 1
  fi
  if [ "$state" = "2" ]; then
    echo "refusing: namespace inventory unreadable (uncertain pre-existing state)" >&2
    return 1
  fi
  ip netns add "$name" || return 1
  CREATED_NS+=("$name")
  return 0
}

# Deletes only the namespaces this run created. Reports a failed deletion or an
# unreadable inventory with the owned-name inventory and returns 1 (leaving CREATED_NS
# intact); returns 0 (and clears CREATED_NS) only when nothing owned remains.
do_cleanup() {
  [ -n "$relay_pid" ] && kill "$relay_pid" 2>/dev/null || true
  [ -n "$gateway_pid" ] && kill "$gateway_pid" 2>/dev/null || true
  [ -n "$forbidden_pid" ] && kill "$forbidden_pid" 2>/dev/null || true
  local i ns state
  local failed=0
  LEFTOVER_NS=()
  for ((i = ${#CREATED_NS[@]} - 1; i >= 0; i--)); do
    ns="${CREATED_NS[$i]}"
    namespace_exists "$ns"
    state=$?
    if [ "$state" = "0" ]; then
      if ! ip netns del "$ns" 2>/dev/null; then
        LEFTOVER_NS+=("$ns")
        failed=1
      fi
    elif [ "$state" = "2" ]; then
      LEFTOVER_NS+=("$ns(inventory-unreadable)")
      failed=1
    fi
    # state=1: confirmed absent; nothing to do.
  done
  if [ "$failed" = "1" ]; then
    echo "WARNING: teardown incomplete; the following owned namespaces are uncertain/remaining and require manual reconciliation:" >&2
    printf '  - %s\n' "${LEFTOVER_NS[@]}" >&2
    return 1
  fi
  CREATED_NS=()
  return 0
}

# Runs on every exit. Bash preserves an already-decided exit status even if the trap
# returns nonzero, so this trap re-runs cleanup and then explicitly calls `exit` to force
# a nonzero status when cleanup or inventory verification is uncertain.
on_exit() {
  local code=$?
  local cleanup_rc=0 verify_rc=0
  do_cleanup; cleanup_rc=$?
  verify_cleanup; verify_rc=$?
  if [ "$cleanup_rc" != "0" ] || [ "$verify_rc" != "0" ]; then
    echo "FATAL: cleanup or inventory verification uncertain; exiting nonzero for manual reconciliation" >&2
    exit 1
  fi
  exit "$code"
}
trap on_exit EXIT

fail() { echo "FAIL: $*" >&2; exit 1; }

verify_cleanup() {
  local list
  if ! list=$(ip netns list 2>/dev/null); then
    echo "FAIL: cannot read namespace inventory; residue state unknown" >&2
    return 1
  fi
  if printf '%s\n' "$list" | grep -q "b30-"; then
    echo "FAIL: b30-* namespace residue remains" >&2
    return 1
  fi
  if ip -4 addr show 2>/dev/null | grep -qE "10\.100\."; then
    echo "FAIL: 10.100.x address residue in initial namespace" >&2
    return 1
  fi
  if ip route show 2>/dev/null | grep -qE "10\.100\."; then
    echo "FAIL: 10.100.x route residue in initial namespace" >&2
    return 1
  fi
  return 0
}

# Self-test: collision refusal + owned-only cleanup using disposable namespaces only.
self_test() {
  echo "=== self-test: collision refusal + owned cleanup ===" | tee -a "$OUT"
  local pre="b30-selftest-existing-$SUFFIX"
  ip netns add "$pre" || fail "self-test setup failed"
  CREATED_NS+=("$pre")   # tracked so any exit path cleans it up

  if create_ns "$pre"; then
    echo "FAIL: collision refusal did not trigger" | tee -a "$OUT"; exit 1
  fi
  if namespace_exists "$pre"; then
    echo "PASS: pre-existing namespace survived collision refusal" | tee -a "$OUT"
  else
    echo "FAIL: pre-existing namespace was deleted" | tee -a "$OUT"; exit 1
  fi
  ip netns del "$pre" || fail "self-test pre cleanup failed"

  local owned="b30-selftest-owned-$SUFFIX"
  create_ns "$owned" || fail "self-test create failed"
  if namespace_exists "$owned"; then
    echo "PASS: owned namespace created" | tee -a "$OUT"
  else
    echo "FAIL: owned namespace missing" | tee -a "$OUT"; exit 1
  fi
  if do_cleanup; then
    echo "PASS: cleanup removed owned namespaces" | tee -a "$OUT"
  else
    echo "FAIL: cleanup left residue" | tee -a "$OUT"; exit 1
  fi
  if verify_cleanup; then
    echo "PASS: no residue remains" | tee -a "$OUT"
  else
    echo "FAIL: residue remains" | tee -a "$OUT"; exit 1
  fi
  echo "RESULT: self-test passed" | tee -a "$OUT"
  exit 0
}

# Controlled early-failure injection (run as a separate top-level invocation with
# `--self-test-fault`): create owned disposable namespaces, then fail so the EXIT trap
# must remove them. The caller verifies no `b30-fault-*` residue remains after the
# nonzero exit.
self_test_fault() {
  echo "=== self-test-fault: partial-failure cleanup via EXIT trap ===" | tee -a "$OUT"
  local a="b30-fault-a-$SUFFIX"
  local b="b30-fault-b-$SUFFIX"
  create_ns "$a" || fail "fault setup a"
  create_ns "$b" || fail "fault setup b"
  echo "SIMULATED: partial configuration failure after two namespaces; EXIT trap must clean up" | tee -a "$OUT"
  fail "SIMULATED: partial configuration failure"
}

# Controlled delete-failure injection: shadow `ip` so `ip netns del` fails, and verify
# do_cleanup reports it and preserves ownership. Confined to disposable namespaces.
self_test_delete_fault() {
  echo "=== self-test-delete-fault: failed ip netns del ===" | tee -a "$OUT"
  local owned="b30-delfault-$SUFFIX"
  ip netns add "$owned" || fail "delete-fault setup failed"
  CREATED_NS+=("$owned")
  ip() {
    if [ "$1" = "netns" ] && [ "$2" = "del" ]; then
      echo "fake ip: simulated netns del failure" >&2
      return 1
    fi
    command ip "$@"
  }
  if do_cleanup; then
    echo "FAIL: cleanup reported success despite a failed delete" | tee -a "$OUT"; unset -f ip; exit 1
  fi
  if [ "${#CREATED_NS[@]}" = "0" ]; then
    echo "FAIL: ownership was cleared despite a failed delete" | tee -a "$OUT"; unset -f ip; exit 1
  fi
  unset -f ip
  command ip netns del "$owned" 2>/dev/null || true
  CREATED_NS=()
  echo "PASS: failed delete reported, ownership preserved, inventory listed" | tee -a "$OUT"
  echo "RESULT: self-test-delete-fault passed" | tee -a "$OUT"
  exit 0
}

# Controlled inventory-failure injection: shadow `ip` so `ip netns list` fails, and verify
# do_cleanup treats it as uncertain and preserves ownership. Confined to disposable
# namespaces.
self_test_inventory_fault() {
  echo "=== self-test-inventory-fault: unreadable ip netns list ===" | tee -a "$OUT"
  local owned="b30-invfault-$SUFFIX"
  ip netns add "$owned" || fail "inventory-fault setup failed"
  CREATED_NS+=("$owned")
  ip() {
    if [ "$1" = "netns" ] && [ "$2" = "list" ]; then
      echo "fake ip: simulated netns list failure" >&2
      return 1
    fi
    command ip "$@"
  }
  if do_cleanup; then
    echo "FAIL: cleanup reported success despite unreadable inventory" | tee -a "$OUT"; unset -f ip; exit 1
  fi
  if [ "${#CREATED_NS[@]}" = "0" ]; then
    echo "FAIL: ownership was cleared despite unreadable inventory" | tee -a "$OUT"; unset -f ip; exit 1
  fi
  unset -f ip
  command ip netns del "$owned" 2>/dev/null || true
  CREATED_NS=()
  echo "PASS: unreadable inventory reported as uncertain, ownership preserved" | tee -a "$OUT"
  echo "RESULT: self-test-inventory-fault passed" | tee -a "$OUT"
  exit 0
}

# Controlled trap-status injection: shadow `ip` so `ip netns del` fails, then reach a
# deliberate `exit 0`; the EXIT trap must override it to nonzero because cleanup is
# uncertain. The caller verifies a nonzero exit and manually reconciles the leftover.
self_test_trap_status() {
  echo "=== self-test-trap-status: EXIT trap forces nonzero on cleanup failure ===" | tee -a "$OUT"
  local owned="b30-trapstatus-$SUFFIX"
  ip netns add "$owned" || fail "trap-status setup failed"
  CREATED_NS+=("$owned")
  ip() {
    if [ "$1" = "netns" ] && [ "$2" = "del" ]; then
      echo "fake ip: simulated netns del failure" >&2
      return 1
    fi
    command ip "$@"
  }
  echo "SIMULATED: success-path exit 0 with an unresolved owned namespace" | tee -a "$OUT"
  exit 0
}

# Capability-mask helpers. Pure string checks with no 64-bit arithmetic, so missing or
# malformed input fails closed instead of defaulting to zero.

# cap_mask_zero <label> <mask> : 0 if the mask is the canonical all-zero 64-bit mask
# (16 hex zeros as printed by /proc/self/status); nonzero otherwise.
cap_mask_zero() {
  local label="$1" m="$2"
  [ -n "$m" ] || { echo "$label missing" >&2; return 1; }
  case "$m" in
    *[!0-9a-fA-F]*) echo "$label malformed ($m)" >&2; return 1 ;;
  esac
  [ "$m" = "0000000000000000" ] || { echo "$label not empty ($m)" >&2; return 1; }
  return 0
}

# cap_bit_set <16-hex-mask> <bit> : 0 if bit <bit> (0-63) is set, 1 if clear, 2 if the mask
# is not a canonical 16-digit mask. Uses nibble extraction, never parses the full value.
cap_bit_set() {
  local m="$1" bit="$2" idx off charidx d v
  [ ${#m} -eq 16 ] || return 2
  idx=$(( bit / 4 ))
  off=$(( bit % 4 ))
  charidx=$(( 15 - idx ))
  d="${m:$charidx:1}"
  case "$d" in
    0|1|2|3|4|5|6|7|8|9) v=$d ;;
    a|A) v=10 ;; b|B) v=11 ;; c|C) v=12 ;; d|D) v=13 ;; e|E) v=14 ;; f|F) v=15 ;;
    *) return 2 ;;
  esac
  [ $(( (v >> off) & 1 )) -eq 1 ]
}

# Fail-closed worker privilege boundary. Returns 0 only when the unprivileged worker shows
# UID/GID 65534, CapInh/CapPrm/CapEff all-zero, NET_ADMIN (12) and SYS_ADMIN (21) absent
# from CapBnd, NoNewPrivs=1, both mutation attempts refused, both post-mutation state reads
# succeeded, and no unauthorized table/default route was installed. Any missing/malformed
# inventory value fails the verdict (never defaults to zero).
verify_worker_privileges() {
  local uid="$1" gid="$2" capinh="$3" capprm="$4" capeff="$5" capbnd="$6" nnp="$7" \
        nft_rc="$8" route_rc="$9" no_table="${10}" no_route="${11}" \
        nft_read_ok="${12}" route_read_ok="${13}"
  local b12 b21
  [ "$uid" = "$WORKER_UID" ] || { echo "worker uid wrong (uid=$uid)" >&2; return 1; }
  [ "$gid" = "$WORKER_GID" ] || { echo "worker gid wrong (gid=$gid)" >&2; return 1; }
  cap_mask_zero "worker CapInh" "$capinh" || return 1
  cap_mask_zero "worker CapPrm" "$capprm" || return 1
  cap_mask_zero "worker CapEff" "$capeff" || return 1
  cap_bit_set "$capbnd" 12; b12=$?
  cap_bit_set "$capbnd" 21; b21=$?
  if [ "$b12" != "1" ] || [ "$b21" != "1" ]; then
    echo "worker CapBnd retains NET_ADMIN/SYS_ADMIN or is malformed (CapBnd=$capbnd)" >&2
    return 1
  fi
  [ "$nnp" = "1" ] || { echo "worker NoNewPrivs not set ($nnp)" >&2; return 1; }
  [ "$nft_rc" != "0" ] || { echo "worker nft mutation succeeded" >&2; return 1; }
  [ "$route_rc" != "0" ] || { echo "worker route mutation succeeded" >&2; return 1; }
  [ "$nft_read_ok" = "1" ] || { echo "post-mutation nft inventory read failed (uncertain)" >&2; return 1; }
  [ "$route_read_ok" = "1" ] || { echo "post-mutation route inventory read failed (uncertain)" >&2; return 1; }
  [ "$no_table" = "1" ] || { echo "unauthorized nft table installed" >&2; return 1; }
  [ "$no_route" = "1" ] || { echo "unauthorized default route installed" >&2; return 1; }
  return 0
}

self_test_capability() {
  echo "=== self-test-capability: worker privilege-boundary verdict ===" | tee -a "$OUT"
  local ok=1 CAP0="0000000000000000" CAPBND_OK="000001ffffdfefff"
  local CAPBND_NETADMIN="000001ffffdfffff" CAPBND_SYSADMIN="000001ffffffefff"
  reject() {
    local label="$1"; shift
    if verify_worker_privileges "$@"; then
      echo "FAIL $label (bad input accepted)" | tee -a "$OUT"; ok=0
    else
      echo "PASS $label (rejected)" | tee -a "$OUT"
    fi
  }
  # Good inputs (the real observed unprivileged worker) must pass.
  if verify_worker_privileges 65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 1 1 2 1 1 1 1; then
    echo "PASS good worker inventory accepted" | tee -a "$OUT"
  else
    echo "FAIL good worker inventory rejected" | tee -a "$OUT"; ok=0
  fi
  # Each simulated bad input must be rejected (fail closed, never defaults to zero).
  reject "nft mutation success"         65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 1 0 2 1 1 1 1
  reject "route mutation success"       65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 1 1 0 1 1 1 1
  reject "wrong uid"                    0     65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 1 1 2 1 1 1 1
  reject "wrong gid"                    65534 0     "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 1 1 2 1 1 1 1
  reject "missing CapEff"               65534 65534 "$CAP0" "$CAP0" ""     "$CAPBND_OK" 1 1 2 1 1 1 1
  reject "malformed CapEff"             65534 65534 "$CAP0" "$CAP0" "0x1"  "$CAPBND_OK" 1 1 2 1 1 1 1
  reject "nonzero CapEff"               65534 65534 "$CAP0" "$CAP0" "0000000000000001" "$CAPBND_OK" 1 1 2 1 1 1 1
  reject "nonzero CapPrm (permitted)"   65534 65534 "$CAP0" "0000000000000001" "$CAP0" "$CAPBND_OK" 1 1 2 1 1 1 1
  reject "nonzero CapInh (inheritable)" 65534 65534 "0000000000000001" "$CAP0" "$CAP0" "$CAPBND_OK" 1 1 2 1 1 1 1
  reject "retained NET_ADMIN CapBnd"    65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_NETADMIN" 1 1 2 1 1 1 1
  reject "retained SYS_ADMIN CapBnd"    65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_SYSADMIN" 1 1 2 1 1 1 1
  reject "missing CapBnd"               65534 65534 "$CAP0" "$CAP0" "$CAP0" "" 1 1 2 1 1 1 1
  reject "unset NoNewPrivs"             65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 0 1 2 1 1 1 1
  reject "unauthorized nft table"       65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 1 1 2 0 1 1 1
  reject "unauthorized default route"   65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 1 1 2 1 0 1 1
  reject "nft inventory read failed"    65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 1 1 2 1 1 0 1
  reject "route inventory read failed"  65534 65534 "$CAP0" "$CAP0" "$CAP0" "$CAPBND_OK" 1 1 2 1 1 1 0
  if [ "$ok" = "1" ]; then echo "RESULT: self-test-capability passed" | tee -a "$OUT"; exit 0; else echo "RESULT: self-test-capability FAILED" | tee -a "$OUT"; exit 1; fi
}

[ "${1:-}" = "--self-test" ] && self_test
[ "${1:-}" = "--self-test-fault" ] && self_test_fault
[ "${1:-}" = "--self-test-delete-fault" ] && self_test_delete_fault
[ "${1:-}" = "--self-test-inventory-fault" ] && self_test_inventory_fault
[ "${1:-}" = "--self-test-trap-status" ] && self_test_trap_status
[ "${1:-}" = "--self-test-capability" ] && self_test_capability

: > "$LOG"
echo "=== B30 egress namespace fixture ===" | tee "$OUT"
echo "requiring root and ip netns support" | tee -a "$OUT"
[ "$(id -u)" = "0" ] || { echo "FAIL: not root" | tee -a "$OUT"; exit 2; }

# 1. Three disposable namespaces; refuse collisions without touching existing state.
create_ns "$WORKER_NS" || fail "cannot create worker namespace"
create_ns "$RELAY_NS" || fail "cannot create relay namespace"
create_ns "$GATEWAY_NS" || fail "cannot create gateway namespace"

# 2. Create each veth pair INSIDE a disposable namespace, then move only the peer.
#    `ip link add` never runs in the initial namespace.
ip netns exec "$RELAY_NS" ip link add "$LINK_W" type veth peer name "$LINK_R" || fail "veth worker-relay"
ip netns exec "$RELAY_NS" ip link set "$LINK_W" netns "$WORKER_NS" || fail "move worker peer"
ip netns exec "$RELAY_NS" ip link add "$LINK_R2" type veth peer name "$LINK_G" || fail "veth relay-gateway"
ip netns exec "$RELAY_NS" ip link set "$LINK_G" netns "$GATEWAY_NS" || fail "move gateway peer"

# 3. Addresses + loopback inside each namespace, no default route, IPv6 disabled.
for ns in "$WORKER_NS" "$RELAY_NS" "$GATEWAY_NS"; do
  ip -n "$ns" link set lo up || fail "loopback up in $ns"
done
ip -n "$WORKER_NS" link set "$LINK_W" up || fail "worker link up"
ip -n "$RELAY_NS" link set "$LINK_R" up || fail "relay link up"
ip -n "$RELAY_NS" link set "$LINK_R2" up || fail "relay link2 up"
ip -n "$GATEWAY_NS" link set "$LINK_G" up || fail "gateway link up"
ip -n "$WORKER_NS" addr add "$WORKER_IP/24" dev "$LINK_W" || fail "worker addr"
ip -n "$RELAY_NS" addr add "$RELAY_IP/24" dev "$LINK_R" || fail "relay addr"
ip -n "$RELAY_NS" addr add "$RELAY_GW_IP/24" dev "$LINK_R2" || fail "relay addr2"
ip -n "$GATEWAY_NS" addr add "$GATEWAY_IP/24" dev "$LINK_G" || fail "gateway addr"
for ns in "$WORKER_NS" "$RELAY_NS" "$GATEWAY_NS"; do
  ip -n "$ns" -4 route del default 2>/dev/null || true
  ip -n "$ns" -6 addr flush scope global 2>/dev/null || true
done

# 3a. nftables default-drop OUTPUT/FORWARD inside the worker and relay namespaces only.
#     The gateway namespace keeps no external route (fixture terminal point) and is left
#     without egress rules. The WSL initial/host namespace is never touched. Each chain
#     uses `policy drop`; a final `counter drop` makes dropped packets observable, and the
#     allow rules carry `counter` so accepted traffic is observable too.
command -v nft >/dev/null 2>&1 || fail "nftables is not installed (host firewall untouched)"
# Worker: allow only worker -> relay fixed port.
ip netns exec "$WORKER_NS" nft add table inet b30fw || fail "worker nft table"
ip netns exec "$WORKER_NS" nft add chain inet b30fw output '{ type filter hook output priority 0; policy drop; }' || fail "worker nft output"
ip netns exec "$WORKER_NS" nft add chain inet b30fw forward '{ type filter hook forward priority 0; policy drop; }' || fail "worker nft forward"
ip netns exec "$WORKER_NS" nft add rule inet b30fw output ct state established,related accept || fail "worker nft conntrack"
ip netns exec "$WORKER_NS" nft add rule inet b30fw output ip daddr "$RELAY_IP" tcp dport "$RELAY_PORT" counter accept || fail "worker allow relay"
ip netns exec "$WORKER_NS" nft add rule inet b30fw output counter drop || fail "worker nft drop"
# Relay: allow only relay -> gateway fixed port.
ip netns exec "$RELAY_NS" nft add table inet b30fw || fail "relay nft table"
ip netns exec "$RELAY_NS" nft add chain inet b30fw output '{ type filter hook output priority 0; policy drop; }' || fail "relay nft output"
ip netns exec "$RELAY_NS" nft add chain inet b30fw forward '{ type filter hook forward priority 0; policy drop; }' || fail "relay nft forward"
ip netns exec "$RELAY_NS" nft add rule inet b30fw output ct state established,related accept || fail "relay nft conntrack"
ip netns exec "$RELAY_NS" nft add rule inet b30fw output ip daddr "$GATEWAY_IP" tcp dport "$GATEWAY_PORT" counter accept || fail "relay allow gateway"
ip netns exec "$RELAY_NS" nft add rule inet b30fw output counter drop || fail "relay nft drop"

# 4. Inventory.
{
  echo "=== ip netns list ==="; ip netns list
  for ns in "$WORKER_NS" "$RELAY_NS" "$GATEWAY_NS"; do
    echo "=== $ns addr ==="; ip -n "$ns" addr
    echo "=== $ns route ==="; ip -n "$ns" route
    echo "=== $ns -6 route ==="; ip -n "$ns" -6 route
    echo "=== $ns nft ruleset ==="; ip netns exec "$ns" nft list ruleset 2>&1
  done
} >> "$LOG" 2>&1

# 5. Routing probes (deterministic, no packets).
probe_route() {
  local ns="$1" dst="$2"
  local msg rc
  msg=$(ip netns exec "$ns" ip route get "$dst" 2>&1)
  rc=$?
  printf '%-10s route-get %-18s rc=%d %s\n' "$ns" "$dst" "$rc" "$msg" | tee -a "$OUT"
  case "$msg" in
    *"unreachable"*) return 1 ;;
    *) return 0 ;;
  esac
}

echo "=== routing probes ===" | tee -a "$OUT"
probe_route "$WORKER_NS" "$INTERNET_V4";  worker_inet_rc=$?
probe_route "$WORKER_NS" "$GATEWAY_IP";  worker_gw_rc=$?
probe_route "$WORKER_NS" "$RELAY_IP";    worker_relay_rc=$?
probe_route "$RELAY_NS" "$INTERNET_V4";  relay_inet_rc=$?
probe_route "$RELAY_NS" "$GATEWAY_IP";   relay_gw_rc=$?
probe_route "$GATEWAY_NS" "$INTERNET_V4"; gw_inet_rc=$?
probe_route "$GATEWAY_NS" "$WORKER_IP";  gw_worker_rc=$?

# 6. Real socket attempts. Listeners in the relay and gateway namespaces only.
ip netns exec "$RELAY_NS" python3 -m http.server "$RELAY_PORT" --bind "$RELAY_IP" >> "$LOG" 2>&1 &
relay_pid=$!
ip netns exec "$GATEWAY_NS" python3 -m http.server "$GATEWAY_PORT" --bind "$GATEWAY_IP" >> "$LOG" 2>&1 &
gateway_pid=$!
# A forbidden service on the relay at a non-allowed port: routable but nft-dropped.
ip netns exec "$RELAY_NS" python3 -m http.server "$FORBIDDEN_PORT" --bind "$RELAY_IP" >> "$LOG" 2>&1 &
forbidden_pid=$!
sleep 1

probe_curl() {
  local ns="$1" url="$2" wrap="${3:-}"
  local msg rc
  # shellcheck disable=SC2086
  msg=$(ip netns exec "$ns" $wrap curl -sS --connect-timeout 2 -o /dev/null -w '%{http_code}' "$url" 2>&1)
  rc=$?
  printf '%-10s curl      %-26s rc=%d result=%s\n' "$ns" "$url" "$rc" "$msg" | tee -a "$OUT"
  return "$rc"
}

# Force IPv6 egress attempt.
probe_curl6() {
  local ns="$1" url="$2" wrap="${3:-}"
  local msg rc
  # shellcheck disable=SC2086
  msg=$(ip netns exec "$ns" $wrap curl -6 -sS --connect-timeout 2 -o /dev/null -w '%{http_code}' "$url" 2>&1)
  rc=$?
  printf '%-10s curl6     %-26s rc=%d result=%s\n' "$ns" "$url" "$rc" "$msg" | tee -a "$OUT"
  return "$rc"
}

# WebSocket-like upgrade attempt (HTTP GET with Upgrade headers). A real WebSocket
# handshake cannot start unless this TCP connection succeeds.
probe_upgrade() {
  local ns="$1" url="$2" wrap="${3:-}"
  local msg rc
  # shellcheck disable=SC2086
  msg=$(ip netns exec "$ns" $wrap curl -sS --http1.1 --connect-timeout 2 -o /dev/null -w '%{http_code}' \
    -H 'Connection: Upgrade' -H 'Upgrade: websocket' -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: SGVsbG8=' \
    "$url" 2>&1)
  rc=$?
  printf '%-10s upgrade   %-26s rc=%d result=%s\n' "$ns" "$url" "$rc" "$msg" | tee -a "$OUT"
  return "$rc"
}

# Worker-side probes drop to the unprivileged worker identity (nobody, no_new_privs,
# no NET_ADMIN/SYS_ADMIN). Relay/gateway probes run as the trusted setup identity.
worker_drop_counter() {
  ip netns exec "$WORKER_NS" nft list chain inet b30fw output 2>/dev/null \
    | awk '/counter packets [0-9]+ bytes [0-9]+ drop/{ for (i=1;i<=NF;i++) if ($i=="packets") { print $(i+1); exit } }'
}

echo "=== socket probes ===" | tee -a "$OUT"
# Worker-side probes run as the unprivileged worker identity (nobody, no_new_privs,
# no NET_ADMIN/SYS_ADMIN). Relay/gateway probes stay trusted (service-owned).
probe_curl "$WORKER_NS" "http://$INTERNET_V4/" "$UNPRIV";           worker_inet_sock=$?
probe_curl "$WORKER_NS" "http://$GATEWAY_IP:$GATEWAY_PORT/" "$UNPRIV"; worker_gw_sock=$?
probe_curl "$WORKER_NS" "http://$RELAY_IP:$RELAY_PORT/" "$UNPRIV";  worker_relay_sock=$?
probe_curl "$RELAY_NS" "http://$INTERNET_V4/";            relay_inet_sock=$?
probe_curl "$RELAY_NS" "http://$GATEWAY_IP:$GATEWAY_PORT/"; relay_gw_sock=$?
probe_curl "$GATEWAY_NS" "http://$INTERNET_V4/";          gw_inet_sock=$?
# Active negative probes: direct IPv6, DNS, and WebSocket/upgrade egress from the worker.
probe_curl6 "$WORKER_NS" "http://[$INTERNET_V6]/" "$UNPRIV";        worker_inet6_sock=$?
probe_curl "$WORKER_NS" "http://$DNS_PROBE_HOST/" "$UNPRIV";        worker_dns_sock=$?
probe_upgrade "$WORKER_NS" "http://$INTERNET_V4/" "$UNPRIV";        worker_ws_sock=$?

# Verify the forbidden listener is actually bound, then record the worker nft drop counter
# before and after the forbidden-port probe, and require the nft-dropped timeout (rc=28).
if ip netns exec "$RELAY_NS" ss -ltn 2>/dev/null | grep -q ":$FORBIDDEN_PORT "; then
  forbidden_listener_ok=1
else
  forbidden_listener_ok=0
fi
forbidden_drop_before=$(worker_drop_counter)
probe_curl "$WORKER_NS" "http://$RELAY_IP:$FORBIDDEN_PORT/" "$UNPRIV"; worker_forbidden_sock=$?
forbidden_drop_after=$(worker_drop_counter)
if [ -n "$forbidden_drop_before" ] && [ -n "$forbidden_drop_after" ] && [ "$forbidden_drop_after" -gt "$forbidden_drop_before" ]; then
  forbidden_drop_delta=1
else
  forbidden_drop_delta=0
fi

# Unprivileged worker capability inventory + mutation refusal. Captured as variables so
# the verdict can enforce them (not merely log them). The inventory read must itself yield
# every required field; a missing/malformed field fails the verdict (never defaults to zero).
worker_cap_out=$(ip netns exec "$WORKER_NS" $UNPRIV sh -c 'grep -E "^(CapInh|CapPrm|CapEff|CapBnd|NoNewPrivs)" /proc/self/status' 2>&1)
worker_capinh=$(printf '%s\n' "$worker_cap_out" | awk '/^CapInh:/{print $2}')
worker_capprm=$(printf '%s\n' "$worker_cap_out" | awk '/^CapPrm:/{print $2}')
worker_capeff=$(printf '%s\n' "$worker_cap_out" | awk '/^CapEff:/{print $2}')
worker_capbnd=$(printf '%s\n' "$worker_cap_out" | awk '/^CapBnd:/{print $2}')
worker_nnp=$(printf '%s\n' "$worker_cap_out" | awk '/^NoNewPrivs:/{print $2}')
worker_uid=$(ip netns exec "$WORKER_NS" $UNPRIV id -u 2>&1)
worker_gid=$(ip netns exec "$WORKER_NS" $UNPRIV id -g 2>&1)
nft_mut_out=$(ip netns exec "$WORKER_NS" $UNPRIV nft add table inet b30evil 2>&1); nft_mut_rc=$?
route_mut_out=$(ip netns exec "$WORKER_NS" $UNPRIV ip route add default via "$RELAY_IP" 2>&1); route_mut_rc=$?
# Post-attempt reads of the actual namespace state. The reads must succeed (authoritative
# root observation); a failed read is uncertainty (fail closed), not "no unauthorized state".
nft_tables_out=$(ip netns exec "$WORKER_NS" nft list tables 2>&1); nft_tables_rc=$?
route_show_out=$(ip netns exec "$WORKER_NS" ip route show 2>&1); route_show_rc=$?
if [ "$nft_tables_rc" = "0" ]; then nft_read_ok=1; else nft_read_ok=0; fi
if [ "$route_show_rc" = "0" ]; then route_read_ok=1; else route_read_ok=0; fi
if [ "$nft_read_ok" = "1" ] && printf '%s\n' "$nft_tables_out" | grep -q "b30evil"; then no_unauth_table=0; else no_unauth_table=1; fi
if [ "$route_read_ok" = "1" ] && printf '%s\n' "$route_show_out" | grep -q "^default"; then no_unauth_route=0; else no_unauth_route=1; fi
{
  echo "=== unprivileged worker capability inventory ==="
  echo "$worker_cap_out"
  echo "worker_uid=$worker_uid worker_gid=$worker_gid"
  echo "=== unprivileged nft mutation attempt (expect refusal) ==="
  echo "$nft_mut_out"
  echo "nft_mutation_rc=$nft_mut_rc"
  echo "=== unprivileged route mutation attempt (expect refusal) ==="
  echo "$route_mut_out"
  echo "route_mutation_rc=$route_mut_rc"
  echo "=== post-mutation state reads (must succeed) ==="
  echo "$nft_tables_out"
  echo "nft_tables_rc=$nft_tables_rc"
  echo "$route_show_out"
  echo "route_show_rc=$route_show_rc"
  echo "no_unauth_table=$no_unauth_table no_unauth_route=$no_unauth_route"
} >> "$LOG" 2>&1

# Record the per-namespace nft ruleset with counters after the probes.
{
  echo "=== nft counters (post-probe) ==="
  ip netns exec "$WORKER_NS" nft list ruleset 2>&1
  ip netns exec "$RELAY_NS" nft list ruleset 2>&1
} >> "$LOG" 2>&1

# 7. Assert the containment.
echo "=== verdict ===" | tee -a "$OUT"
fail=0
check_ok() { local label="$1" rc="$2"; if [ "$rc" = "0" ]; then echo "PASS $label" | tee -a "$OUT"; else echo "FAIL $label (expected success, got rc=$rc)" | tee -a "$OUT"; fail=1; fi; }
check_denied() { local label="$1" rc="$2"; if [ "$rc" != "0" ]; then echo "PASS $label (denied)" | tee -a "$OUT"; else echo "FAIL $label (unexpectedly reachable)" | tee -a "$OUT"; fail=1; fi; }
check_true() { local label="$1" v="$2"; if [ "$v" = "1" ]; then echo "PASS $label" | tee -a "$OUT"; else echo "FAIL $label" | tee -a "$OUT"; fail=1; fi; }
check_denied "worker->internet route denied"  "$worker_inet_rc"
check_denied "worker->gateway route denied"   "$worker_gw_rc"
check_ok     "worker->relay route reachable"  "$worker_relay_rc"
check_denied "relay->internet route denied"   "$relay_inet_rc"
check_ok     "relay->gateway route reachable" "$relay_gw_rc"
check_denied "gateway->internet route denied" "$gw_inet_rc"
check_denied "gateway->worker route denied"   "$gw_worker_rc"
check_denied "worker->internet socket denied" "$worker_inet_sock"
check_denied "worker->gateway socket denied"  "$worker_gw_sock"
check_ok     "worker->relay socket ok"        "$worker_relay_sock"
check_denied "relay->internet socket denied"  "$relay_inet_sock"
check_ok     "relay->gateway socket ok"       "$relay_gw_sock"
check_denied "gateway->internet socket denied" "$gw_inet_sock"
check_denied "worker->IPv6 egress denied"     "$worker_inet6_sock"
check_denied "worker->DNS resolution denied"  "$worker_dns_sock"
check_denied "worker->WebSocket upgrade denied" "$worker_ws_sock"
check_true   "forbidden listener bound on :$FORBIDDEN_PORT" "$forbidden_listener_ok"
if [ "$worker_forbidden_sock" = "28" ]; then
  echo "PASS worker->forbidden relay port timeout (rc=28, nft OUTPUT drop)" | tee -a "$OUT"
else
  echo "FAIL worker->forbidden relay port (expected rc=28, got rc=$worker_forbidden_sock)" | tee -a "$OUT"; fail=1
fi
check_true   "forbidden probe incremented the nft drop counter" "$forbidden_drop_delta"

# 7b. Worker privilege boundary: the capability inventory, both mutation outcomes, and the
#     post-mutation state reads must satisfy fail-closed expectations, or the run fails.
if verify_worker_privileges "$worker_uid" "$worker_gid" "$worker_capinh" "$worker_capprm" "$worker_capeff" "$worker_capbnd" "$worker_nnp" "$nft_mut_rc" "$route_mut_rc" "$no_unauth_table" "$no_unauth_route" "$nft_read_ok" "$route_read_ok"; then
  echo "PASS worker privilege boundary (uid=$worker_uid gid=$worker_gid CapInh=$worker_capinh CapPrm=$worker_capprm CapEff=$worker_capeff CapBnd=$worker_capbnd NoNewPrivs=$worker_nnp nft_rc=$nft_mut_rc route_rc=$route_mut_rc)" | tee -a "$OUT"
else
  echo "FAIL worker privilege boundary (uid=$worker_uid gid=$worker_gid CapInh=$worker_capinh CapPrm=$worker_capprm CapEff=$worker_capeff CapBnd=$worker_capbnd NoNewPrivs=$worker_nnp nft_rc=$nft_mut_rc route_rc=$route_mut_rc)" | tee -a "$OUT"; fail=1
fi

# 8. Explicit teardown + verification. A failed deletion or unreadable inventory is
#    reported (not silent) and makes the run fail closed.
if do_cleanup; then
  if verify_cleanup; then
    echo "PASS: teardown removed all owned objects, no initial-namespace residue" | tee -a "$OUT"
  else
    echo "FAIL: teardown left residue (requires manual reconciliation)" | tee -a "$OUT"; fail=1
  fi
else
  echo "FAIL: teardown could not confirm removal of owned namespaces (see inventory above; manual reconciliation required)" | tee -a "$OUT"; fail=1
fi

if [ "$fail" = "0" ]; then echo "RESULT: containment verified" | tee -a "$OUT"; exit 0; else echo "RESULT: containment FAILED" | tee -a "$OUT"; exit 1; fi
