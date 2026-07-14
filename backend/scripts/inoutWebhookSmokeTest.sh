#!/usr/bin/env bash
#
# InOut webhook smoke test.
#
# Signs request bodies with the staging signature key (HMAC-SHA256 over the raw
# body, exactly like the provider) and exercises init/bet/withdraw/rollback,
# including an idempotency replay of withdraw.
#
# Requires: bash, curl, openssl.
#
# Usage:
#   BASE_URL="https://api.sokasport.com" \
#   SECRET="<INOUT_SIGNATURE_KEY>" \
#   TOKEN="<token from seedInoutTestPlayer.mjs>" \
#   OPERATOR="<INOUT_OPERATOR_ID>" \
#   ./scripts/inoutWebhookSmokeTest.sh
#
# Optional:
#   CURRENCY (default ETB), AMOUNT (default 10.00), RESULT (default 25.00)

set -euo pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
SECRET="${SECRET:?Set SECRET to the INOUT_SIGNATURE_KEY}"
TOKEN="${TOKEN:?Set TOKEN to a valid InoutGameSession token}"
OPERATOR="${OPERATOR:?Set OPERATOR to the INOUT_OPERATOR_ID}"
CURRENCY="${CURRENCY:-ETB}"
AMOUNT="${AMOUNT:-10.00}"
RESULT="${RESULT:-25.00}"

URL="${BASE_URL}/api/integrations/inout/webhook"

# Stable ids so withdraw references the bet, and replays are idempotent.
BET_TX="$(uuidgen 2>/dev/null || echo "bet-$(date +%s)")"
WD_TX="$(uuidgen 2>/dev/null || echo "wd-$(date +%s)")"
RB_TX="$(uuidgen 2>/dev/null || echo "rb-$(date +%s)")"
GAME_ID="$(uuidgen 2>/dev/null || echo "game-$(date +%s)")"
# A rollback/withdraw pointing at a debit that never happened.
NX_RB_TX="$(uuidgen 2>/dev/null || echo "nxrb-$(date +%s)")"
NX_DEBIT="$(uuidgen 2>/dev/null || echo "nxdebit-$(date +%s)")"

# HMAC-SHA256 hex of the exact bytes passed in $1.
sign() {
  printf '%s' "$1" | openssl dgst -sha256 -hmac "$SECRET" -hex | awk '{print $NF}'
}

# send <label> <json-body> [sign-override]
send() {
  local label="$1" body="$2" sig
  sig="${3:-$(sign "$body")}"
  echo "=============================================="
  echo "▶ ${label}"
  echo "  body: ${body}"
  echo "  sign: ${sig}"
  echo "----------------------------------------------"
  curl -sS -o /tmp/inout_smoke_body -w "  HTTP %{http_code}\n" \
    -X POST "$URL" \
    -H "Content-Type: application/json" \
    -H "X-REQUEST-SIGN: ${sig}" \
    --data-binary "$body" || true
  echo "  resp: $(cat /tmp/inout_smoke_body)"
  echo
}

INIT_BODY="{\"action\":\"init\",\"token\":\"${TOKEN}\",\"data\":{\"currency\":\"${CURRENCY}\",\"operator\":\"${OPERATOR}\",\"gameMode\":\"lucky-mines\"}}"
BET_BODY="{\"action\":\"bet\",\"token\":\"${TOKEN}\",\"gameMode\":\"lucky-mines\",\"data\":{\"amount\":\"${AMOUNT}\",\"currency\":\"${CURRENCY}\",\"operator\":\"${OPERATOR}\",\"user_id\":\"1\",\"transactionId\":\"${BET_TX}\",\"gameId\":\"${GAME_ID}\"}}"
WD_BODY="{\"action\":\"withdraw\",\"token\":\"${TOKEN}\",\"gameMode\":\"lucky-mines\",\"data\":{\"amount\":\"${AMOUNT}\",\"result\":\"${RESULT}\",\"currency\":\"${CURRENCY}\",\"operator\":\"${OPERATOR}\",\"user_id\":\"1\",\"transactionId\":\"${WD_TX}\",\"debitId\":\"${BET_TX}\",\"gameId\":\"${GAME_ID}\",\"isFinished\":true}}"
RB_BODY="{\"action\":\"rollback\",\"token\":\"${TOKEN}\",\"gameMode\":\"lucky-mines\",\"data\":{\"amount\":\"${AMOUNT}\",\"currency\":\"${CURRENCY}\",\"operator\":\"${OPERATOR}\",\"user_id\":\"1\",\"transactionId\":\"${RB_TX}\",\"debitId\":\"${BET_TX}\",\"gameId\":\"${GAME_ID}\",\"isFinished\":true}}"
NX_RB_BODY="{\"action\":\"rollback\",\"token\":\"${TOKEN}\",\"gameMode\":\"lucky-mines\",\"data\":{\"amount\":\"${AMOUNT}\",\"currency\":\"${CURRENCY}\",\"operator\":\"${OPERATOR}\",\"user_id\":\"1\",\"transactionId\":\"${NX_RB_TX}\",\"debitId\":\"${NX_DEBIT}\",\"gameId\":\"${GAME_ID}\",\"isFinished\":true}}"

echo "Target: ${URL}"
echo "Bet tx: ${BET_TX} | Withdraw tx: ${WD_TX} | Rollback tx: ${RB_TX}"
echo

send "init (expect 200 OK + balance)" "$INIT_BODY"
send "init with BAD signature (expect 401 INVALID_TOKEN)" "$INIT_BODY" "deadbeef"
send "bet (expect 200 OK, balance drops by ${AMOUNT})" "$BET_BODY"
send "withdraw (expect 200 OK, balance credited ${RESULT})" "$WD_BODY"
send "withdraw REPLAY (idempotent: same balance, no double credit)" "$WD_BODY"
send "rollback (expect 200 OK, refunds ${AMOUNT})" "$RB_BODY"
send "rollback of NON-EXISTENT debit (expect 404 DEBIT_TRANSACTION_NOT_FOUND, balance unchanged)" "$NX_RB_BODY"

echo "Done. Review balances above: bet debits ${AMOUNT}, withdraw credits ${RESULT},"
echo "withdraw replay must NOT change balance, rollback credits ${AMOUNT},"
echo "and the non-existent-debit rollback must ERROR without changing the balance."
