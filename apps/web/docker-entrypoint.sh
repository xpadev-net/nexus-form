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

  origin="$(printf '%s' "$value" | sed -E 's@^((https?|wss?)://[^/?#]+).*@\1@')"
  if printf '%s' "$origin" | grep -Eq '^(https?|wss?)://([A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\])(:[0-9]+)?$'; then
    port="$(printf '%s' "$origin" | sed -nE 's@^(https?|wss?)://([A-Za-z0-9._-]+|\[[0-9A-Fa-f:.]+\]):([0-9]+)$@\3@p')"
    if [ -n "$port" ] && ! { [ "$port" -ge 1 ] && [ "$port" -le 65535 ]; } 2>/dev/null; then
      return 1
    fi

    printf '%s' "$origin"
    return 0
  fi

  return 1
}

escape_sed_replacement() {
  printf '%s' "$1" | sed -e 's/[\\&#]/\\&/g'
}

append_connect_src_from_host_env() {
  env_name="$1"
  env_value="$2"

  if [ -z "$env_value" ]; then
    return 0
  fi

  normalized_origin="$(normalize_csp_origin "$env_value")" ||
    {
      normalized_origin="$(normalize_csp_origin "https://$env_value")" || {
        echo "[web] Warning: normalize_csp_origin rejected $env_name='$env_value'; not added to csp_connect_src/CSP_CONNECT_SRC" >&2
        return 0
      }
      echo "[web] Info: $env_name='$env_value' has no scheme; using $normalized_origin in csp_connect_src/CSP_CONNECT_SRC" >&2
    }

  csp_connect_src="$csp_connect_src $normalized_origin"
}

csp_connect_src="'self' https://hcaptcha.com https://*.hcaptcha.com"
if [ -n "${VITE_API_URL:-}" ]; then
  api_origin="$(normalize_csp_origin "$VITE_API_URL")" || {
    echo "[web] Warning: normalize_csp_origin rejected VITE_API_URL='$VITE_API_URL'; not added to csp_connect_src/CSP_CONNECT_SRC" >&2
    api_origin=""
  }
else
  api_origin=""
fi
if [ -n "$api_origin" ]; then
  csp_connect_src="$csp_connect_src $api_origin"
fi
append_connect_src_from_host_env "VITE_TELEMETRY_HOST" "${VITE_TELEMETRY_HOST:-}"
append_connect_src_from_host_env "VITE_TELEMETRY_V4_HOST" "${VITE_TELEMETRY_V4_HOST:-}"
append_connect_src_from_host_env "VITE_TELEMETRY_V6_HOST" "${VITE_TELEMETRY_V6_HOST:-}"

# CSP_CONNECT_SRC is a space-separated list of additional origins.
set -f
for extra_origin in ${CSP_CONNECT_SRC:-}; do
  normalized_origin="$(normalize_csp_origin "$extra_origin")" || {
    echo "[web] Ignoring invalid CSP_CONNECT_SRC origin: $extra_origin" >&2
    continue
  }
  csp_connect_src="$csp_connect_src $normalized_origin"
done
set +f

csp_img_src="'self' data: blob:"

# CSP_IMG_SRC is a space-separated list of additional image origins.
set -f
for extra_origin in ${CSP_IMG_SRC:-}; do
  normalized_origin="$(normalize_csp_origin "$extra_origin")" || {
    echo "[web] Ignoring invalid CSP_IMG_SRC origin: $extra_origin" >&2
    continue
  }
  case "$normalized_origin" in
    http://* | https://*) ;;
    *)
      echo "[web] Ignoring invalid CSP_IMG_SRC origin: $extra_origin" >&2
      continue
      ;;
  esac
  csp_img_src="$csp_img_src $normalized_origin"
done
set +f

sed -i "s#__CSP_IMG_SRC__#$(escape_sed_replacement "$csp_img_src")#g" /etc/nginx/conf.d/default.conf
sed -i "s#__CSP_CONNECT_SRC__#$(escape_sed_replacement "$csp_connect_src")#g" /etc/nginx/conf.d/default.conf

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
