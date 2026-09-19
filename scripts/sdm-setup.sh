#!/usr/bin/env bash
# Enable SDM + Pub/Sub on the GCP project and create the events topic/subscription.
set -euo pipefail
PROJECT="${GCP_PROJECT:-gen-lang-client-0973407358}"
TOPIC="${SDM_TOPIC:-sdm-events}"
SUB="${SDM_SUB:-sdm-events-zoto}"
GCLOUD="${GCLOUD:-$HOME/.local/google-cloud-sdk/google-cloud-sdk/bin/gcloud}"
if [[ ! -x "$GCLOUD" ]]; then
  GCLOUD="$(command -v gcloud)"
fi
"$GCLOUD" config set project "$PROJECT"
"$GCLOUD" services enable smartdevicemanagement.googleapis.com pubsub.googleapis.com --project "$PROJECT"
"$GCLOUD" pubsub topics create "$TOPIC" --project "$PROJECT" --message-retention-duration=1h || true
"$GCLOUD" pubsub topics add-iam-policy-binding "$TOPIC" \
  --project "$PROJECT" \
  --member="group:sdm-publisher@googlegroups.com" \
  --role="roles/pubsub.publisher"
"$GCLOUD" pubsub subscriptions create "$SUB" --project "$PROJECT" --topic "$TOPIC" || true
echo "topic: projects/${PROJECT}/topics/${TOPIC}"
echo "subscription: projects/${PROJECT}/subscriptions/${SUB}"
echo "Create a Web OAuth client (redirect https://www.google.com), then put client_id/secret + Device Access UUID in ~/.zoto-viz/sdm.yml"
