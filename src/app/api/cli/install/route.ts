import { NextResponse } from "next/server";
import rootPackage from "../../../../../package.json";

export const dynamic = "force-dynamic";

function serverOrigin(request: Request) {
    const headers = request.headers;
    const forwardedHost = headers.get("x-forwarded-host");
    const host = forwardedHost ?? headers.get("host") ?? new URL(request.url).host;
    const forwardedProto = headers.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const proto = forwardedProto || new URL(request.url).protocol.replace(/:$/, "") || "http";
    return `${proto}://${host}`.replace(/\/$/, "");
}

function installScript(origin: string) {
    const version = rootPackage.version;
    return `#!/bin/sh
set -eu

server=${JSON.stringify(origin)}
version=${JSON.stringify(version)}
os=$(uname -s | tr '[:upper:]' '[:lower:]')
arch=$(uname -m)

case "$os" in
  linux) os="linux" ;;
  darwin) os="darwin" ;;
  *) echo "Unsupported operating system: $os" >&2; exit 1 ;;
esac

case "$arch" in
  x86_64|amd64) arch="x64" ;;
  arm64|aarch64) arch="arm64" ;;
  *) echo "Unsupported architecture: $arch" >&2; exit 1 ;;
esac

platform="$os-$arch"
bin_dir="$HOME/.quickstack/bin"
config_dir="$HOME/.quickstack"
binary_url="$server/api/cli/$version/$platform/quickstack"

mkdir -p "$bin_dir" "$config_dir"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$binary_url" -o "$bin_dir/quickstack"
elif command -v wget >/dev/null 2>&1; then
  wget -q "$binary_url" -O "$bin_dir/quickstack"
else
  echo "curl or wget is required to install quickstack" >&2
  exit 1
fi
chmod +x "$bin_dir/quickstack"
cat > "$config_dir/config.json" <<EOF
{
  "server": "$server",
  "url": "$server"
}
EOF
chmod 600 "$config_dir/config.json"
echo "Installed quickstack $version for $platform to $bin_dir/quickstack."
case ":$PATH:" in
  *:"$bin_dir":*) ;;
  *) echo "Add $bin_dir to PATH to run quickstack from a fresh shell." ;;
esac
`;
}

export async function GET(request: Request) {
    return new NextResponse(installScript(serverOrigin(request)), {
        headers: {
            "content-type": "text/x-sh; charset=utf-8",
            "cache-control": "no-store",
            "X-QuickStack-Server-Version": rootPackage.version,
        },
    });
}
