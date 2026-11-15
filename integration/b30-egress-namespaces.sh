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

LOG="${B30_LOG:-/tmp/b30-egress.log}"
OUT="${B30_OUT:-/tmp/b30-egress-out.txt}"
RELAY_PORT=18081
GATEWAY_PORT=18082

# Ownership tracking: only namespaces in this array are ever deleted. LEFTOVER_NS holds
# the inventory of owned namespaces whose deletion failed or whose absence could not be
# confirmed (requiring manual reconciliation). CREATED_NS is cleared only after every
# owned namespace is confirmed gone.
CREATED_NS=()
LEFTOVER_NS=()
relay_pid=""
gateway_pid=""

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

[ "${1:-}" = "--self-test" ] && self_test
[ "${1:-}" = "--self-test-fault" ] && self_test_fault
[ "${1:-}" = "--self-test-delete-fault" ] && self_test_delete_fault
[ "${1:-}" = "--self-test-inventory-fault" ] && self_test_inventory_fault
[ "${1:-}" = "--self-test-trap-status" ] && self_test_trap_status

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

# 4. Inventory.
{
  echo "=== ip netns list ==="; ip netns list
  for ns in "$WORKER_NS" "$RELAY_NS" "$GATEWAY_NS"; do
    echo "=== $ns addr ==="; ip -n "$ns" addr
    echo "=== $ns route ==="; ip -n "$ns" route
    echo "=== $ns -6 route ==="; ip -n "$ns" -6 route
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
sleep 1

probe_curl() {
  local ns="$1" url="$2"
  local msg rc
  msg=$(ip netns exec "$ns" curl -sS --connect-timeout 2 -o /dev/null -w '%{http_code}' "$url" 2>&1)
  rc=$?
  printf '%-10s curl      %-26s rc=%d result=%s\n' "$ns" "$url" "$rc" "$msg" | tee -a "$OUT"
  return "$rc"
}

echo "=== socket probes ===" | tee -a "$OUT"
probe_curl "$WORKER_NS" "http://$INTERNET_V4/";           worker_inet_sock=$?
probe_curl "$WORKER_NS" "http://$GATEWAY_IP:$GATEWAY_PORT/"; worker_gw_sock=$?
probe_curl "$WORKER_NS" "http://$RELAY_IP:$RELAY_PORT/";  worker_relay_sock=$?
probe_curl "$RELAY_NS" "http://$INTERNET_V4/";            relay_inet_sock=$?
probe_curl "$RELAY_NS" "http://$GATEWAY_IP:$GATEWAY_PORT/"; relay_gw_sock=$?
probe_curl "$GATEWAY_NS" "http://$INTERNET_V4/";          gw_inet_sock=$?

# 7. Assert the containment.
echo "=== verdict ===" | tee -a "$OUT"
fail=0
check_ok() { local label="$1" rc="$2"; if [ "$rc" = "0" ]; then echo "PASS $label" | tee -a "$OUT"; else echo "FAIL $label (expected success, got rc=$rc)" | tee -a "$OUT"; fail=1; fi; }
check_denied() { local label="$1" rc="$2"; if [ "$rc" != "0" ]; then echo "PASS $label (denied)" | tee -a "$OUT"; else echo "FAIL $label (unexpectedly reachable)" | tee -a "$OUT"; fail=1; fi; }
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
