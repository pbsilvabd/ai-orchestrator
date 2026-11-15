#!/usr/bin/env bash
# B30 OS-network egress fixture (ADR-010 deployment gate). Run only inside an
# isolated, disposable WSL2 Ubuntu distribution as root. It creates two temporary
# network namespaces plus veth pairs, assigns private addresses with no default
# route, records a full routing inventory, and performs real socket attempts that
# prove the worker can reach only the relay and the relay can reach only the host
# gateway. Everything is torn down fail-closed on exit; no Windows networking, WSL
# host namespace route/firewall, Hyper-V switch, package install or live route is
# touched. All probes target private or TEST-NET addresses that fail locally.
#
# This is a deployment observation, not a unit test; it must be run by a maintainer
# with WSL2 Ubuntu and CAP_NET_ADMIN. It does not contact a provider or the Internet.
set -u

WORKER_NS="b30-worker"
RELAY_NS="b30-relay"
LINK_A="b30-w0"   # worker side of worker<->relay veth
LINK_B="b30-r0"   # relay side of worker<->relay veth
LINK_C="b30-r1"   # relay side of relay<->host veth
LINK_D="b30-h0"   # host side of relay<->host veth
RELAY_IP="10.100.1.1"
WORKER_IP="10.100.1.2"
GATEWAY_IP="10.100.2.1"
RELAY_GW_IP="10.100.2.2"
INTERNET_V4="192.0.2.1"       # TEST-NET-1, never routed
INTERNET_V6="2001:db8::1"     # documentation prefix

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
  ip link del "$LINK_A" 2>/dev/null
  ip link del "$LINK_C" 2>/dev/null
  ip netns del "$WORKER_NS" 2>/dev/null
  ip netns del "$RELAY_NS" 2>/dev/null
  echo "cleanup done" >> "$LOG"
}
trap cleanup EXIT

: > "$LOG"
echo "=== B30 egress namespace fixture ===" | tee "$OUT"
echo "requiring root and ip netns support" | tee -a "$OUT"
[ "$(id -u)" = "0" ] || { echo "FAIL: not root" | tee -a "$OUT"; exit 2; }

step() { echo "[$1]" >> "$LOG"; }

# 1. Create isolated compartments.
step "create-namespaces"
ip netns add "$WORKER_NS" || { echo "FAIL: cannot create worker netns" | tee -a "$OUT"; exit 2; }
ip netns add "$RELAY_NS" || { echo "FAIL: cannot create relay netns" | tee -a "$OUT"; exit 2; }
ip link add "$LINK_A" type veth peer name "$LINK_B" || { echo "FAIL: cannot create veth" | tee -a "$OUT"; exit 2; }
ip link add "$LINK_C" type veth peer name "$LINK_D" || { echo "FAIL: cannot create veth" | tee -a "$OUT"; exit 2; }
ip link set "$LINK_B" netns "$RELAY_NS"
ip link set "$LINK_A" netns "$WORKER_NS"
ip link set "$LINK_C" netns "$RELAY_NS"
ip link set "$LINK_D" up

# 2. Addresses + loopback, no default route, IPv6 disabled on the veth links.
step "configure-addresses"
ip -n "$WORKER_NS" link set lo up
ip -n "$RELAY_NS" link set lo up
ip -n "$WORKER_NS" link set "$LINK_A" up
ip -n "$RELAY_NS" link set "$LINK_B" up
ip -n "$RELAY_NS" link set "$LINK_C" up
ip -n "$WORKER_NS" addr add "$WORKER_IP/24" dev "$LINK_A"
ip -n "$RELAY_NS" addr add "$RELAY_IP/24" dev "$LINK_B"
ip -n "$RELAY_NS" addr add "$RELAY_GW_IP/24" dev "$LINK_C"
ip addr add "$GATEWAY_IP/24" dev "$LINK_D"
ip -n "$WORKER_NS" -4 route del default 2>/dev/null || true
ip -n "$RELAY_NS" -4 route del default 2>/dev/null || true
ip -n "$WORKER_NS" -6 addr flush dev "$LINK_A" 2>/dev/null || true
ip -n "$RELAY_NS" -6 addr flush dev "$LINK_B" 2>/dev/null || true
ip -n "$RELAY_NS" -6 addr flush dev "$LINK_C" 2>/dev/null || true

# 3. Inventory.
step "inventory"
{
  echo "=== ip netns list ==="; ip netns list
  echo "=== worker addr ==="; ip -n "$WORKER_NS" addr
  echo "=== worker route ==="; ip -n "$WORKER_NS" route
  echo "=== worker -6 route ==="; ip -n "$WORKER_NS" -6 route
  echo "=== relay addr ==="; ip -n "$RELAY_NS" addr
  echo "=== relay route ==="; ip -n "$RELAY_NS" route
  echo "=== relay -6 route ==="; ip -n "$RELAY_NS" -6 route
  echo "=== host b30 link ==="; ip addr show "$LINK_D"
} >> "$LOG" 2>&1

# 4. Routing probes (deterministic, no packets).
probe_route() {
  local ns="$1" dst="$2"
  local msg
  msg=$(ip netns exec "$ns" ip route get "$dst" 2>&1)
  local rc=$?
  printf '%-8s route-get %-18s rc=%d %s\n' "$ns" "$dst" "$rc" "$msg" | tee -a "$OUT"
  case "$msg" in
    *"unreachable"*) return 1 ;;
    *) return 0 ;;
  esac
}

echo "=== routing probes ===" | tee -a "$OUT"
probe_route "$WORKER_NS" "$INTERNET_V4"
worker_inet_rc=$?
probe_route "$WORKER_NS" "$GATEWAY_IP"
worker_gw_rc=$?
probe_route "$WORKER_NS" "$RELAY_IP"
worker_relay_rc=$?
probe_route "$RELAY_NS" "$INTERNET_V4"
relay_inet_rc=$?
probe_route "$RELAY_NS" "$GATEWAY_IP"
relay_gw_rc=$?

# 5. Real socket attempts. Listeners: relay (10.100.1.1) and gateway (10.100.2.1).
step "socket-probes"
ip netns exec "$RELAY_NS" python3 -m http.server "$RELAY_PORT" --bind "$RELAY_IP" >> "$LOG" 2>&1 &
relay_pid=$!
python3 -m http.server "$GATEWAY_PORT" --bind "$GATEWAY_IP" >> "$LOG" 2>&1 &
gateway_pid=$!
sleep 1

probe_curl() {
  local ns="$1" url="$2"
  local msg
  msg=$(ip netns exec "$ns" curl -sS --connect-timeout 2 -o /dev/null -w '%{http_code}' "$url" 2>&1)
  local rc=$?
  printf '%-8s curl      %-26s rc=%d result=%s\n' "$ns" "$url" "$rc" "$msg" | tee -a "$OUT"
  return "$rc"
}

echo "=== socket probes ===" | tee -a "$OUT"
probe_curl "$WORKER_NS" "http://$INTERNET_V4/"
worker_inet_sock=$?
probe_curl "$WORKER_NS" "http://$GATEWAY_IP:$GATEWAY_PORT/"
worker_gw_sock=$?
probe_curl "$WORKER_NS" "http://$RELAY_IP:$RELAY_PORT/"
worker_relay_sock=$?
probe_curl "$RELAY_NS" "http://$INTERNET_V4/"
relay_inet_sock=$?
probe_curl "$RELAY_NS" "http://$GATEWAY_IP:$GATEWAY_PORT/"
relay_gw_sock=$?

# 6. Assert the containment.
echo "=== verdict ===" | tee -a "$OUT"
fail=0
check_ok() { local label="$1" rc="$2"; if [ "$rc" = "0" ]; then echo "PASS $label" | tee -a "$OUT"; else echo "FAIL $label (expected success, got rc=$rc)" | tee -a "$OUT"; fail=1; fi; }
check_denied() { local label="$1" rc="$2"; if [ "$rc" != "0" ]; then echo "PASS $label (denied)" | tee -a "$OUT"; else echo "FAIL $label (unexpectedly reachable)" | tee -a "$OUT"; fail=1; fi; }
check_denied "worker->internet route denied"   "$worker_inet_rc"
check_denied "worker->gateway route denied"    "$worker_gw_rc"
check_ok     "worker->relay route reachable"   "$worker_relay_rc"
check_denied "relay->internet route denied"    "$relay_inet_rc"
check_ok     "relay->gateway route reachable"  "$relay_gw_rc"
check_denied "worker->internet socket denied"  "$worker_inet_sock"
check_denied "worker->gateway socket denied"   "$worker_gw_sock"
check_ok     "worker->relay socket ok"         "$worker_relay_sock"
check_denied "relay->internet socket denied"   "$relay_inet_sock"
check_ok     "relay->gateway socket ok"        "$relay_gw_sock"

[ "$fail" = "0" ] && echo "RESULT: containment verified" | tee -a "$OUT" || echo "RESULT: containment FAILED" | tee -a "$OUT"
exit "$fail"
