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

normalize_csp_origin() {
  value="$1"
  case "$value" in
    http://* | https://* | ws://* | wss://*) ;;
    *) return 1 ;;
  esac

  origin="$(printf '%s' "$value" | sed -E 's#^((https?|wss?)://[^/?#]+).*#\1#')"
  if printf '%s' "$origin" | grep -Eq '^(https?|wss?)://[A-Za-z0-9._:-]+$'; then
    printf '%s' "$origin"
    return 0
  fi

  return 1
}

csp_connect_src="'self' https://hcaptcha.com https://*.hcaptcha.com"
api_origin="$(normalize_csp_origin "${VITE_API_URL:-}")" || api_origin=""
if [ -n "$api_origin" ]; then
  csp_connect_src="$csp_connect_src $api_origin"
fi

for extra_origin in ${CSP_CONNECT_SRC:-}; do
  normalized_origin="$(normalize_csp_origin "$extra_origin")" || {
    echo "[web] Ignoring invalid CSP_CONNECT_SRC origin: $extra_origin" >&2
    continue
  }
  csp_connect_src="$csp_connect_src $normalized_origin"
done

sed -i "s#__CSP_CONNECT_SRC__#$csp_connect_src#g" /etc/nginx/conf.d/default.conf

cat <<EOF > /usr/share/nginx/html/env-config.js
window.__NEXUS_FORM_CONFIG__ = {
  apiUrl: $(json_encode "${VITE_API_URL:-}"),
  formSecurityDevBypass: $(json_encode "${VITE_FORM_SECURITY_DEV_BYPASS:-}"),
  hcaptchaSiteKey: $(json_encode "${VITE_HCAPTCHA_SITE_KEY:-}"),
  telemetryHost: $(json_encode "${VITE_TELEMETRY_HOST:-}"),
  telemetryV4Host: $(json_encode "${VITE_TELEMETRY_V4_HOST:-}"),
  telemetryV6Host: $(json_encode "${VITE_TELEMETRY_V6_HOST:-}"),
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

echo "[web] Commit: ${GIT_HASH:-unknown}"

exec "$@"
