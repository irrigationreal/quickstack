import fs from "fs";
import path from "path";

const ALLOWED_PLATFORMS = new Set(["linux-x64", "linux-arm64", "darwin-x64", "darwin-arm64"]);
const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?$/;

type AvailableBinary = {
    version: string;
    platform: string;
};

class CliDistributionService {
    private readonly cliRoot = path.join(process.cwd(), "public", "cli");

    resolveBinaryPath(version: string, platform: string): string | null {
        if (!SEMVER_PATTERN.test(version) || !ALLOWED_PLATFORMS.has(platform)) {
            return null;
        }

        const binaryPath = path.join(this.cliRoot, version, platform, "quickstack");
        const relativePath = path.relative(this.cliRoot, binaryPath);
        if (relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
            return null;
        }

        return fs.existsSync(binaryPath) ? binaryPath : null;
    }

    listAvailableBinaries(): AvailableBinary[] {
        if (!fs.existsSync(this.cliRoot)) {
            return [];
        }

        const binaries: AvailableBinary[] = [];
        for (const version of fs.readdirSync(this.cliRoot)) {
            if (!SEMVER_PATTERN.test(version)) {
                continue;
            }
            const versionDir = path.join(this.cliRoot, version);
            if (!fs.statSync(versionDir).isDirectory()) {
                continue;
            }
            for (const platform of fs.readdirSync(versionDir)) {
                if (!ALLOWED_PLATFORMS.has(platform)) {
                    continue;
                }
                if (this.resolveBinaryPath(version, platform)) {
                    binaries.push({ version, platform });
                }
            }
        }
        return binaries.sort((left, right) => `${left.version}/${left.platform}`.localeCompare(`${right.version}/${right.platform}`));
    }
}

const cliDistributionService = new CliDistributionService();
export default cliDistributionService;
