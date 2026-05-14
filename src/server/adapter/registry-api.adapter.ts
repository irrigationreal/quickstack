import { DEFAULT_REGISTRY_TOKEN_ISSUER, REGISTRY_TOKEN_SERVICE } from "../services/registry-auth-config";
import paramService, { ParamService } from "../services/param.service";
import registryTokenSigningService from "../services/registry-token-signing.service";

interface OCIManifest {
    schemaVersion: number;
    mediaType: string;
    config: {
        mediaType: string;
        size: number;
        digest: string;
    };
    layers: Array<{
        mediaType: string;
        size: number;
        digest: string;
    }>;
    annotations: {
        [key: string]: string;
    };
}

// Source: https://distribution.github.io/distribution/spec/api/

class RegistryApiAdapter {

    private registryBaseUrl = process.env.NODE_ENV === 'production' ?
        'http://registry-svc.registry-and-build.svc.cluster.local:5000' :
        'http://localhost:5000';

    async getAllImages() {

        const token = await this.internalBearerToken();
        const response = await fetch(`${this.registryBaseUrl}/v2/_catalog`, {
            cache: 'no-cache',
            method: 'GET',
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });

        await this.checkIfResponseIsOk(response);
        const data = await response.json() as { repositories: string[] } | null;
        return data?.repositories ?? [] as string[];
    }

    async listTagsForImage(imageName: string) {

        const token = await this.internalBearerToken(imageName);
        const response = await fetch(`${this.registryBaseUrl}/v2/${imageName}/tags/list`, {
            cache: 'no-cache',
            method: 'GET',
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                'Accept': 'application/json',
                'Content-Type': 'application/json'
            }
        });


        if (!response.ok) {
            console.error(`Error while fetching ${response.url} ${response.status} ${response.statusText}`);
            console.error(response.headers);
            console.error(response);
            try {
                const resText = await response.text();
                if (resText.includes('NAME_UNKNOWN')) {
                    // manifest was deleted but repository name still exists in catalog
                    return [];
                }
                console.error(resText);
            } catch (error) {
                // do nothing
            }
            throw new Error(`Error while connecting to container registry.`);
        }

        const data = await response.json();
        return data?.tags ?? [] as string[];
    }

    async getManifest(repository: string, tag: string) {
        const response = await this.manifestRequest(repository, tag);
        const data = await response.json() as OCIManifest;
        return data;
    }

    async getManifestWithDigest(repository: string, tag: string) {

        const response = await this.manifestRequest(repository, tag);
        const digest = response.headers.get("Docker-Content-Digest");
        if (!digest) {
            console.error(response.headers);
            throw new Error("Digest not found in response headers.");
        }
        return [digest, await response.json()] as [string, OCIManifest];
    }

    private async internalBearerToken(repository?: string, actions = ['pull']) {
        const directAuthEnabled = await paramService.getBoolean(ParamService.REGISTRY_DIRECT_AUTH_ENABLED, false) ?? false;
        if (!directAuthEnabled) return undefined;
        const issuer = await paramService.getString(ParamService.REGISTRY_TOKEN_ISSUER, DEFAULT_REGISTRY_TOKEN_ISSUER) ?? DEFAULT_REGISTRY_TOKEN_ISSUER;
        const now = Math.floor(Date.now() / 1000);
        return await registryTokenSigningService.signRs256({
            iss: issuer,
            sub: 'quickstack-server',
            aud: REGISTRY_TOKEN_SERVICE,
            iat: now,
            nbf: now - 30,
            exp: now + 600,
            access: repository ? [{ type: 'repository', name: repository, actions }] : [{ type: 'registry', name: 'catalog', actions: ['*'] }],
        });
    }

    private async manifestRequest(repository: string, tag: string) {
        const token = await this.internalBearerToken(repository);
        const response = await fetch(`${this.registryBaseUrl}/v2/${repository}/manifests/${tag}`, {
            cache: 'no-cache',
            method: 'GET',
            headers: {
                ...(token ? { Authorization: `Bearer ${token}` } : {}),
                "Accept": [
                    'application/vnd.oci.image.manifest.v1+json',
                    'application/vnd.oci.image.index.v1+json',
                    'application/vnd.docker.distribution.manifest.v2+json',
                    'application/vnd.docker.distribution.manifest.v1+json',
                    'application/vnd.docker.container.image.v1+json',
                    'application/vnd.docker.image.rootfs.diff.tar.gzip',
                    'application/vnd.docker.image.rootfs.foreign.diff.tar.gzip',
                    'application/vnd.docker.image.rootfs.diff.tar',
                    'application/vnd.oci.image.layer.v1.tar+gzip',
                    'application/vnd.docker.plugin.v1+json'
                ].join(', ')
            }
        });

        await this.checkIfResponseIsOk(response);
        return response;
    }

    private async deleteBlob(repository: string, digest: string) {
        const token = await this.internalBearerToken(repository, ['pull', 'delete']);
        const response = await fetch(`${this.registryBaseUrl}/v2/${repository}/blobs/${digest}`, {
            cache: 'no-cache',
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        await this.checkIfResponseIsOk(response);
        return response;
    }

    private async deleteManifest(repository: string, digest: string) {
        const token = await this.internalBearerToken(repository, ['pull', 'delete']);
        const response = await fetch(`${this.registryBaseUrl}/v2/${repository}/manifests/${digest}`, {
            cache: 'no-cache',
            method: 'DELETE',
            headers: token ? { Authorization: `Bearer ${token}` } : undefined,
        });

        await this.checkIfResponseIsOk(response);
        return response;
    }

    async deleteImage(repository: string, tag: string) {

        // Step 1: Get the digest of the image
        const [digest, manifest] = await this.getManifestWithDigest(repository, tag);

        console.log(`Digest for ${repository}:${tag} is ${digest}`);

        await Promise.all(manifest.layers.map(async (layer) => {
            console.log(`Deleting blob ${layer.digest} (size: ${layer.size})`);
            try {
                await this.deleteBlob(repository, layer.digest);
            } catch (error) {
                console.error(`Error while deleting blob ${layer.digest}`);
            }
        }));

        console.log(`Deleting manifest ${digest}`);
        await this.deleteManifest(repository, digest);

        console.log(`Image ${repository}:${tag} (size: ${manifest?.config?.size}) successfully deleted from registry.`);

        // return the size of the image
        const totalSize = manifest?.layers?.reduce((sum, layer) => sum + (layer.size || 0), 0) ?? 0;
        return totalSize;
    }

    private async checkIfResponseIsOk(response: Response) {
        if (!response.ok) {
            console.error(`Error while fetching ${response.url} ${response.status} ${response.statusText}`);
            console.error(response.headers);
            console.error(response);
            try {
                console.error(await response.text());
            } catch (error) {
                // do nothing
            }
            throw new Error(`Error while connecting to container registry.`);
        }
    }
}
const registryApiAdapter = new RegistryApiAdapter();
export default registryApiAdapter;