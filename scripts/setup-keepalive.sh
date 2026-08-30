#!/usr/bin/env bash
set -euo pipefail

# Creates (or updates, it is idempotent) a daily EventBridge rule that invokes
# the Lambda with {"source":"lag.keepalive"}. The handler answers it by opening
# a real database connection, so the MongoDB Atlas free cluster registers
# activity and is never auto-paused for inactivity (Atlas pauses free clusters
# after ~60 days without connections).
#
# Configuration comes from .env.deploy (see .env.deploy.example) or from the
# environment: AWS_PROFILE, AWS_REGION, LAMBDA_FUNCTION_NAME, and optionally
# KEEPALIVE_RULE_NAME / KEEPALIVE_SCHEDULE.
#
# Usage: npm run deploy:keepalive

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

if [[ -f .env.deploy ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env.deploy
  set +a
fi

: "${AWS_PROFILE:?Set AWS_PROFILE in .env.deploy or the environment}"
: "${AWS_REGION:?Set AWS_REGION in .env.deploy or the environment}"
: "${LAMBDA_FUNCTION_NAME:?Set LAMBDA_FUNCTION_NAME in .env.deploy or the environment}"

RULE_NAME="${KEEPALIVE_RULE_NAME:-lag-money-manager-keepalive}"
SCHEDULE="${KEEPALIVE_SCHEDULE:-rate(1 day)}"

# Re-authenticates automatically when the session is missing or expired:
# SSO profiles re-run `aws sso login`, any other existing profile re-runs
# the browser-based `aws login`. Long-lived access keys never expire, so
# for them this block only triggers on a misconfiguration.
echo "==> Checking AWS session (profile $AWS_PROFILE)"
if ! aws sts get-caller-identity --profile "$AWS_PROFILE" --no-cli-pager >/dev/null 2>&1; then
  if aws configure get sso_session --profile "$AWS_PROFILE" >/dev/null 2>&1 ||
    aws configure get sso_start_url --profile "$AWS_PROFILE" >/dev/null 2>&1; then
    echo "==> SSO session missing or expired; starting login"
    aws sso login --profile "$AWS_PROFILE"
  elif aws configure list --profile "$AWS_PROFILE" >/dev/null 2>&1; then
    echo "==> Session missing or expired; starting browser login"
    aws login --profile "$AWS_PROFILE"
  else
    echo "ERROR: profile '$AWS_PROFILE' is not configured." >&2
    echo "       Temporary console credentials (recommended):" >&2
    echo "         aws configure set region <region> --profile $AWS_PROFILE && aws login --profile $AWS_PROFILE" >&2
    echo "       Or long-lived access keys: aws configure --profile $AWS_PROFILE" >&2
    exit 1
  fi
fi

echo "==> Creating/updating EventBridge rule '$RULE_NAME' ($SCHEDULE)"
RULE_ARN=$(aws events put-rule \
  --name "$RULE_NAME" \
  --schedule-expression "$SCHEDULE" \
  --description "Daily DB keepalive so the Atlas free cluster is not auto-paused" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --query RuleArn --output text)

FUNCTION_ARN=$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --query FunctionArn --output text)

echo "==> Allowing EventBridge to invoke the function"
aws lambda add-permission \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --statement-id "${RULE_NAME}-invoke" \
  --action lambda:InvokeFunction \
  --principal events.amazonaws.com \
  --source-arn "$RULE_ARN" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --no-cli-pager 2>/dev/null \
  || echo "    (permission already exists, continuing)"

echo "==> Pointing the rule at the function"
aws events put-targets \
  --rule "$RULE_NAME" \
  --targets "[{\"Id\":\"keepalive\",\"Arn\":\"$FUNCTION_ARN\",\"Input\":\"{\\\"source\\\":\\\"lag.keepalive\\\"}\"}]" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --no-cli-pager

echo "==> Keepalive configured. Test it now with:"
echo "    aws lambda invoke --function-name $LAMBDA_FUNCTION_NAME --payload '{\"source\":\"lag.keepalive\"}' --cli-binary-format raw-in-base64-out --profile $AWS_PROFILE --region $AWS_REGION /dev/stdout"
