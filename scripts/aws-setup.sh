#!/usr/bin/env bash
# Creates (or updates) everything an app needs in AWS for Face Liveness:
#   - the face collection        <app>-faces
#   - the server IAM user        <app>-liveness-server  (edge functions sign with its key)
#   - the client IAM role        <app>-liveness-client  (only rekognition:StartFaceLivenessSession;
#                                 the server assumes it to hand the device 15-minute credentials)
#
# Idempotent: running it again changes nothing that already matches.
# It never prints a secret. With --supabase-project, a NEW access key (only when
# the user has none) goes straight into the project's edge secrets through a
# private temporary file, together with the non-secret settings.
#
# Usage: scripts/aws-setup.sh <app> <region> [--supabase-project <ref>] [--secret-prefix FACE_LIVENESS]
# Needs: aws CLI signed in to the target account (e.g. `aws login --profile <p>` + AWS_PROFILE), and the
# supabase CLI when --supabase-project is given.
set -euo pipefail

APP="${1:?usage: aws-setup.sh <app> <region> [--supabase-project <ref>] [--secret-prefix NAME]}"
REGION="${2:?usage: aws-setup.sh <app> <region> [--supabase-project <ref>] [--secret-prefix NAME]}"
shift 2
SUPABASE_PROJECT=""
PREFIX="FACE_LIVENESS"
while [ $# -gt 0 ]; do
  case "$1" in
    --supabase-project) SUPABASE_PROJECT="${2:?}"; shift 2 ;;
    --secret-prefix) PREFIX="${2:?}"; shift 2 ;;
    *) echo "unknown argument: $1" >&2; exit 1 ;;
  esac
done

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
COLLECTION="${APP}-faces"
SERVER_USER="${APP}-liveness-server"
CLIENT_ROLE="${APP}-liveness-client"
CLIENT_ROLE_ARN="arn:aws:iam::${ACCOUNT}:role/${CLIENT_ROLE}"
COLLECTION_ARN="arn:aws:rekognition:${REGION}:${ACCOUNT}:collection/${COLLECTION}"

# 1. Face collection
if ! aws rekognition describe-collection --collection-id "$COLLECTION" --region "$REGION" >/dev/null 2>&1; then
  aws rekognition create-collection --collection-id "$COLLECTION" --region "$REGION" >/dev/null
  echo "created collection $COLLECTION"
fi

# 2. Server user
if ! aws iam get-user --user-name "$SERVER_USER" >/dev/null 2>&1; then
  aws iam create-user --user-name "$SERVER_USER" --tags "Key=app,Value=${APP}" >/dev/null
  echo "created user $SERVER_USER"
fi

# 3. Client role. It trusts the account; who may assume it is then decided by IAM
#    policies (the server user below, and account admins for local testing).
TRUST="{\"Version\":\"2012-10-17\",\"Statement\":[{\"Effect\":\"Allow\",\"Principal\":{\"AWS\":\"arn:aws:iam::${ACCOUNT}:root\"},\"Action\":\"sts:AssumeRole\"}]}"
if aws iam get-role --role-name "$CLIENT_ROLE" >/dev/null 2>&1; then
  aws iam update-assume-role-policy --role-name "$CLIENT_ROLE" --policy-document "$TRUST"
else
  aws iam create-role --role-name "$CLIENT_ROLE" --assume-role-policy-document "$TRUST" \
    --tags "Key=app,Value=${APP}" >/dev/null
  echo "created role $CLIENT_ROLE"
fi
aws iam put-role-policy --role-name "$CLIENT_ROLE" --policy-name liveness-stream --policy-document \
  '{"Version":"2012-10-17","Statement":[{"Effect":"Allow","Action":"rekognition:StartFaceLivenessSession","Resource":"*"}]}'

# 4. Server permissions: sessions and results (no resource-level scoping exists), the
#    collection only, and assuming the client role.
SERVER_POLICY="{\"Version\":\"2012-10-17\",\"Statement\":[
 {\"Effect\":\"Allow\",\"Action\":[\"rekognition:CreateFaceLivenessSession\",\"rekognition:GetFaceLivenessSessionResults\"],\"Resource\":\"*\"},
 {\"Effect\":\"Allow\",\"Action\":[\"rekognition:SearchFacesByImage\",\"rekognition:IndexFaces\",\"rekognition:DeleteFaces\"],\"Resource\":\"${COLLECTION_ARN}\"},
 {\"Effect\":\"Allow\",\"Action\":\"sts:AssumeRole\",\"Resource\":\"${CLIENT_ROLE_ARN}\"}]}"
aws iam put-user-policy --user-name "$SERVER_USER" --policy-name liveness-server --policy-document "$SERVER_POLICY"

echo "region:      $REGION"
echo "collection:  $COLLECTION"
echo "client role: $CLIENT_ROLE_ARN"

# 5. Edge secrets
if [ -n "$SUPABASE_PROJECT" ]; then
  ENV_FILE="$(umask 077; mktemp)"
  trap 'rm -f "$ENV_FILE"' EXIT
  {
    echo "${PREFIX}_AWS_REGION=${REGION}"
    echo "${PREFIX}_CLIENT_ROLE_ARN=${CLIENT_ROLE_ARN}"
    echo "${PREFIX}_COLLECTION_ID=${COLLECTION}"
  } >> "$ENV_FILE"
  KEY_COUNT="$(aws iam list-access-keys --user-name "$SERVER_USER" --query 'length(AccessKeyMetadata)' --output text)"
  if [ "$KEY_COUNT" = "0" ]; then
    aws iam create-access-key --user-name "$SERVER_USER" \
      --query 'AccessKey.[AccessKeyId,SecretAccessKey]' --output text \
      | awk -v p="$PREFIX" '{ print p "_AWS_ACCESS_KEY_ID=" $1; print p "_AWS_SECRET_ACCESS_KEY=" $2 }' >> "$ENV_FILE"
    echo "new access key for $SERVER_USER goes to the Supabase secrets"
  else
    echo "$SERVER_USER already has an access key; not creating another (rotate it on purpose)"
  fi
  supabase secrets set --project-ref "$SUPABASE_PROJECT" --env-file "$ENV_FILE" >/dev/null
  echo "Supabase secrets set: $(cut -d= -f1 "$ENV_FILE" | tr '\n' ' ')"
fi
