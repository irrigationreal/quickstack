import crypto from "crypto";
import { spawnSync } from "child_process";
import fs from "fs";
import os from "os";
import path from "path";
import paramService, { ParamService } from "./param.service";
import { CryptoUtils } from "../utils/crypto.utils";

function keyIdFromPublicJwk(jwk: JsonWebKey) {
    const canonical = JSON.stringify({ e: jwk.e, kty: jwk.kty, n: jwk.n });
    return crypto.createHash('sha256').update(canonical).digest('base64url');
}

function base64UrlJson(value: unknown) {
    return Buffer.from(JSON.stringify(value)).toString('base64url');
}

function publicJwkFromPrivateKey(privateKeyPem: string) {
    const publicJwk = crypto.createPublicKey(privateKeyPem).export({ format: 'jwk' }) as JsonWebKey & { use?: string; alg?: string; kid?: string };
    publicJwk.use = 'sig';
    publicJwk.alg = 'RS256';
    publicJwk.kid = keyIdFromPublicJwk(publicJwk);
    return publicJwk;
}

function selfSignedCertificate(privateKeyPem: string) {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'quickstack-registry-token-'));
    const keyPath = path.join(tmpDir, 'token.key');
    const certPath = path.join(tmpDir, 'token.crt');
    try {
        fs.writeFileSync(keyPath, privateKeyPem, { mode: 0o600 });
        const result = spawnSync('openssl', [
            'req',
            '-new',
            '-x509',
            '-key', keyPath,
            '-out', certPath,
            '-days', '3650',
            '-subj', '/CN=quickstack-registry-token',
        ], { encoding: 'utf8' });
        if (result.status !== 0) {
            throw new Error(`Could not generate registry token public certificate: ${result.stderr || result.stdout}`);
        }
        return fs.readFileSync(certPath, 'utf8');
    } finally {
        fs.rmSync(tmpDir, { recursive: true, force: true });
    }
}

type SigningMaterial = { privateKeyPem: string; publicCertPem: string; publicJwk: JsonWebKey & { kid?: string } };

class RegistryTokenSigningService {
    private cachedMaterial?: SigningMaterial;
    private loadingMaterial?: Promise<SigningMaterial>;

    async ensureSigningMaterial() {
        if (this.cachedMaterial) return this.cachedMaterial;
        if (this.loadingMaterial) return await this.loadingMaterial;
        this.loadingMaterial = this.loadSigningMaterial();
        try {
            this.cachedMaterial = await this.loadingMaterial;
            return this.cachedMaterial;
        } finally {
            this.loadingMaterial = undefined;
        }
    }

    private async loadSigningMaterial() {
        const existingPrivateKey = await paramService.getString(ParamService.REGISTRY_TOKEN_PRIVATE_KEY);
        const existingPublicCert = await paramService.getString(ParamService.REGISTRY_TOKEN_PUBLIC_CERT);
        if (existingPrivateKey && existingPublicCert) {
            const privateKeyPem = CryptoUtils.decrypt(existingPrivateKey);
            return { privateKeyPem, publicCertPem: existingPublicCert, publicJwk: publicJwkFromPrivateKey(privateKeyPem) };
        }

        const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
        const privateKeyPem = privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
        const publicCertPem = selfSignedCertificate(privateKeyPem);
        const publicJwk = publicJwkFromPrivateKey(privateKeyPem);
        await Promise.all([
            paramService.save({ name: ParamService.REGISTRY_TOKEN_PRIVATE_KEY, value: CryptoUtils.encrypt(privateKeyPem) }),
            paramService.save({ name: ParamService.REGISTRY_TOKEN_PUBLIC_CERT, value: publicCertPem }),
        ]);
        return { privateKeyPem, publicCertPem, publicJwk };
    }

    async publicCertPem() {
        const material = await this.ensureSigningMaterial();
        return material.publicCertPem;
    }

    async signRs256(payload: Record<string, unknown>) {
        const material = await this.ensureSigningMaterial();
        const header = { typ: 'JWT', alg: 'RS256', kid: material.publicJwk.kid };
        const signingInput = `${base64UrlJson(header)}.${base64UrlJson(payload)}`;
        const signature = crypto.sign('RSA-SHA256', Buffer.from(signingInput), material.privateKeyPem).toString('base64url');
        return `${signingInput}.${signature}`;
    }
}

const registryTokenSigningService = new RegistryTokenSigningService();
export default registryTokenSigningService;
