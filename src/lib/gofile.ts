/**
 * Live GoFile.io upload integration (v2 API).
 * Queries `GET https://api.gofile.io/servers` -> `data.servers[0].name`,
 * uploads multipart `file` to `https://{server}.gofile.io/contents/uploadfile`,
 * and returns `data.downloadPage`.
 */

const API_ROOT = 'https://api.gofile.io';

export interface GofileUpload {
  link: string;
  page: string;
  server: string;
}

interface GofileServersResponse {
  status?: string;
  data?: {
    servers?: { name?: string; zone?: string }[];
  };
}

interface GofileUploadResponse {
  status?: string;
  data?: {
    downloadPage?: string;
    code?: string;
  };
}

export async function uploadToGofile(blob: Blob, filename: string): Promise<GofileUpload> {
  const serversResponse = await fetch(`${API_ROOT}/servers`);
  if (!serversResponse.ok) {
    throw new Error(`gofile servers responded ${serversResponse.status}`);
  }
  const serversJson = (await serversResponse.json()) as GofileServersResponse;
  const server = serversJson.data?.servers?.find((s) => Boolean(s?.name))?.name;
  if (!server) {
    throw new Error('gofile returned no available server');
  }

  const form = new FormData();
  form.append('file', blob, filename);

  const uploadResponse = await fetch(`https://${server}.gofile.io/contents/uploadfile`, {
    method: 'POST',
    body: form,
  });
  if (!uploadResponse.ok) {
    throw new Error(`gofile upload failed (${uploadResponse.status})`);
  }
  const json = (await uploadResponse.json()) as GofileUploadResponse;
  const page = json.data?.downloadPage;
  if (json.status !== 'ok' || !page) {
    throw new Error('gofile rejected the upload');
  }

  return { link: page, page, server };
}
