declare module "pako" {
  export function gzip(data: Uint8Array | ArrayBuffer | string, options?: any): Uint8Array;
  export function ungzip(data: Uint8Array | ArrayBuffer, options?: any): Uint8Array;
  export function deflate(data: Uint8Array | ArrayBuffer | string, options?: any): Uint8Array;
  export function inflate(data: Uint8Array | ArrayBuffer, options?: any): Uint8Array;
  const pako: {
    gzip: typeof gzip;
    ungzip: typeof ungzip;
    deflate: typeof deflate;
    inflate: typeof inflate;
  };
  export default pako;
}
