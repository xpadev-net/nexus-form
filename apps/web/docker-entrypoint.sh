#!/bin/sh
set -e
# Generate /env-config.js from VITE_* environment variables at container startup
# so the SPA can pick up runtime configuration without rebuilding.

# Helper: JSON-encode a string value (escape backslashes, double-quotes, and
# control characters). Falls back to a simple sed pipeline when jq is absent.
json_encode() {
  if command -v jq >/dev/null 2>&1; then
    # -R: raw input (treat stdin as string, not JSON), -s: slurp into single string
    # printf '%s' ensures no extra trailing newline is included
    printf '%s' "$1" | jq -Rs '.'
  else
    printf '"%s"' "$(printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g')"
  fi
}

cat <<EOF > /usr/share/nginx/html/env-config.js
window.__NEXUS_FORM_CONFIG__ = {
  apiUrl: $(json_encode "${VITE_API_URL:-}"),
  hcaptchaSiteKey: $(json_encode "${VITE_HCAPTCHA_SITE_KEY:-}"),
};
window.__BRAND_CONFIG__ = {
  appName: $(json_encode "${VITE_BRAND_APP_NAME:-}"),
  primaryColor: $(json_encode "${VITE_BRAND_PRIMARY_COLOR:-}"),
  secondaryColor: $(json_encode "${VITE_BRAND_SECONDARY_COLOR:-}"),
  accentColor: $(json_encode "${VITE_BRAND_ACCENT_COLOR:-}"),
  termsUrl: $(json_encode "${VITE_BRAND_TERMS_URL:-}"),
  privacyUrl: $(json_encode "${VITE_BRAND_PRIVACY_URL:-}"),
  copyright: $(json_encode "${VITE_BRAND_COPYRIGHT:-}"),
  homepageUrl: $(json_encode "${VITE_BRAND_HOMEPAGE_URL:-}"),
};
EOF

exec "$@"
