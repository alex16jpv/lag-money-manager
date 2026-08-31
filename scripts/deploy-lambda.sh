#!/usr/bin/env bash
set -euo pipefail

# Builds the Lambda deployment package and uploads it with the AWS CLI.
# Configuration comes from .env.deploy (see .env.deploy.example) or from
# the environment: AWS_PROFILE, AWS_REGION, LAMBDA_FUNCTION_NAME.
#
# Usage: npm run deploy:lambda

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

STAGE_DIR="build/lambda-package"
ZIP_FILE="build/lambda.zip"

echo "==> Compiling TypeScript"
npm run build

# Build indexes before the new code serves traffic (autoIndex is off in prod).
if [[ -n "${MONGO_URI:-}" ]]; then
  echo "==> Syncing MongoDB indexes"
  NODE_ENV=production npm run db:sync-indexes
else
  echo "==> Skipping index sync (MONGO_URI not set); run 'npm run db:sync-indexes' against production before serving traffic" >&2
fi

echo "==> Installing production dependencies into $STAGE_DIR"
rm -rf "$STAGE_DIR" "$ZIP_FILE"
mkdir -p "$STAGE_DIR"
cp package.json package-lock.json "$STAGE_DIR/"
npm ci --omit=dev --prefix "$STAGE_DIR" --no-audit --no-fund
cp -r dist "$STAGE_DIR/dist"

echo "==> Creating $ZIP_FILE"
(cd "$STAGE_DIR" && zip -qr ../lambda.zip dist node_modules package.json)

echo "==> Uploading to '$LAMBDA_FUNCTION_NAME' (region $AWS_REGION, profile $AWS_PROFILE)"
aws lambda update-function-code \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --zip-file "fileb://$ZIP_FILE" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --no-cli-pager \
  --query '{Function:FunctionName,CodeSizeBytes:CodeSize,LastModified:LastModified}'

echo "==> Waiting for the update to finish"
aws lambda wait function-updated \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION"

HANDLER=$(aws lambda get-function-configuration \
  --function-name "$LAMBDA_FUNCTION_NAME" \
  --profile "$AWS_PROFILE" \
  --region "$AWS_REGION" \
  --query Handler --output text)
if [[ "$HANDLER" != "dist/lambda.handler" ]]; then
  echo "WARNING: the function handler is '$HANDLER' but this package expects 'dist/lambda.handler'." >&2
  echo "         Fix it with: aws lambda update-function-configuration --function-name $LAMBDA_FUNCTION_NAME --handler dist/lambda.handler --profile $AWS_PROFILE --region $AWS_REGION" >&2
fi

echo "==> Deploy complete"
