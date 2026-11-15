#!/usr/bin/env bash
# B30 OS-network egress fixture (ADR-010 deployment gate). Run only inside an
# isolated, disposable WSL2 Ubuntu distribution as root. It creates three temporary
# network namespaces plus two veth pairs, assigns private addresses with no default
# route, records a full routing inventory, and performs real socket attempts that prove
# the worker can reach only the relay, the relay can reach only the gateway, and the
# gateway can reach only the relay. The WSL initial/host namespace is never modified:
# both ends of every veth are moved into a disposable namespace, and no host address,
# route, link or firewall is touched. Everything is torn down fail-closed on exit.
#
# This is a deployment observation, not a unit test; it must be run by a maintainer
# with WSL2 Ubuntu and CAP_NET_ADMIN. It does not contact a provider or the Internet.
set -u

WORKER_NS="b30-worker"
RELAY_NS="b30-relay"
GATEWAY_NS="b30-gw"
# veth pair A: worker<->relay
LINK_W="b30-w0"
LINK_R="b30-r0"
# veth pair B: relay<->gateway
LINK_R2="b30-r1"
LINK_G="b30-g0"
RELAY_IP="10.100.1.1"
WORKER_IP="10.100.1.2"
GATEWAY_IP="10.100.2.1"
RELAY_GW_IP="10.100.2.2"
INTERNET_V4="192.0.2.1"       # TEST-NET-1, never routed

LOG="${B30_LOG:-/tmp/b30-egress.log}"
OUT="${B30_OUT:-/tmp/b30-egress-out.txt}"
RELAY_PORT=18081
GATEWAY_PORT=18082
relay_pid=""
gateway_pid=""

cleanup() {
  echo "--- cleanup (fail-closed teardown) ---" >> "$LOG"
  [ -n "$relay_pid" ] && kill "$relay_pid" 2>/dev/null
  [ -n "$gateway_pid" ] && kill "$gateway_pid" 2>/dev/null
  ip link del "$LINK_W" 2>/dev/null
  ip link del "$LINK_R2" 2>/dev/null
  ip netns del "$WORKER_NS" 2>/dev/null
  ip netns del "$RELAY_NS" 2>/dev/null
  ip netns del "$GATEWAY_NS" 2>/dev/null
  echo "cleanup done" >> "$LOG"
}
trap cleanup EXIT

: > "$LOG"
echo "=== B30 egress namespace fixture ===" | tee "$OUT"
echo "requiring root and ip netns support" | tee -a "$OUT"
[ "$(id -u)" = "0" ] || { echo "FAIL: not root" | tee -a "$OUT"; exit 2; }

step() { echo "[$1]" >> "$LOG"; }

# 1. Create three disposable namespaces and two veth pairs. Both ends of every veth
#    move into a namespace, so no host-side link/address/route is created or changed.
step "create-namespaces"
ip netns add "$WORKER_NS" || { echo "FAIL: cannot create worker netns" | tee -a "$OUT"; exit 2; }
ip netns add "$RELAY_NS" || { echo "FAIL: cannot create relay netns" | tee -a "$OUT"; exit 2; }
ip netns add "$GATEWAY_NS" || { echo "FAIL: cannot create gateway netns" | tee -a "$OUT"; exit 2; }
ip link add "$LINK_W" type veth peer name "$LINK_R" || { echo "FAIL: cannot create veth" | tee -a "$OUT"; exit 2; }
ip link add "$LINK_R2" type veth peer name "$LINK_G" || { echo "FAIL: cannot create veth" | tee -a "$OUT"; exit 2; }
ip link set "$LINK_W" netns "$WORKER_NS"
ip link set "$LINK_R" netns "$RELAY_NS"
ip link set "$LINK_R2" netns "$RELAY_NS"
ip link set "$LINK_G" netns "$GATEWAY_NS"

# 2. Addresses + loopback inside each namespace, no default route, IPv6 disabled.
step "configure-addresses"
for ns in "$WORKER_NS" "$RELAY_NS" "$GATEWAY_NS"; do
  ip -n "$ns" link set lo up
done
ip -n "$WORKER_NS" link set "$LINK_W" up
ip -n "$RELAY_NS" link set "$LINK_R" up
ip -n "$RELAY_NS" link set "$LINK_R2" up
ip -n "$GATEWAY_NS" link set "$LINK_G" up
ip -n "$WORKER_NS" addr add "$WORKER_IP/24" dev "$LINK_W"
ip -n "$RELAY_NS" addr add "$RELAY_IP/24" dev "$LINK_R"
ip -n "$RELAY_NS" addr add "$RELAY_GW_IP/24" dev "$LINK_R2"
ip -n "$GATEWAY_NS" addr add "$GATEWAY_IP/24" dev "$LINK_G"
for ns in "$WORKER_NS" "$RELAY_NS" "$GATEWAY_NS"; do
  ip -n "$ns" -4 route del default 2>/dev/null || true
  ip -n "$ns" -6 addr flush scope global 2>/dev/null || true
done

# 3. Inventory.
step "inventory"
{
  echo "=== ip netns list ==="; ip netns list
  for ns in "$WORKER_NS" "$RELAY_NS" "$GATEWAY_NS"; do
    echo "=== $ns addr ==="; ip -n "$ns" addr
    echo "=== $ns route ==="; ip -n "$ns" route
    echo "=== $ns -6 route ==="; ip -n "$ns" -6 route
  done
  echo "=== host (initial) b30 residue check ==="; ip link show | grep -i b30 || echo "none"
} >> "$LOG" 2>&1

# 4. Routing probes (deterministic, no packets).
probe_route() {
  local ns="$1" dst="$2"
  local msg
  msg=$(ip netns exec "$ns" ip route get "$dst" 2>&1)
  local rc=$?
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

# 5. Real socket attempts. Listeners in the relay and gateway namespaces only.
step "socket-probes"
ip netns exec "$RELAY_NS" python3 -m http.server "$RELAY_PORT" --bind "$RELAY_IP" >> "$LOG" 2>&1 &
relay_pid=$!
ip netns exec "$GATEWAY_NS" python3 -m http.server "$GATEWAY_PORT" --bind "$GATEWAY_IP" >> "$LOG" 2>&1 &
gateway_pid=$!
sleep 1

probe_curl() {
  local ns="$1" url="$2"
  local msg
  msg=$(ip netns exec "$ns" curl -sS --connect-timeout 2 -o /dev/null -w '%{http_code}' "$url" 2>&1)
  local rc=$?
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

# 6. Assert the containment.
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

[ "$fail" = "0" ] && echo "RESULT: containment verified" | tee -a "$OUT" || echo "RESULT: containment FAILED" | tee -a "$OUT"
exit "$fail"
