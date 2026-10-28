declare module "jsbarcode/bin/barcodes" {
  interface Encoded {
    data: string;
    text?: string;
  }
  interface Encoder {
    valid(): boolean;
    encode(): Encoded | Encoded[];
  }
  type EncoderClass = new (data: string, options: Record<string, unknown>) => Encoder;
  const barcodes: Record<string, EncoderClass>;
  export default barcodes;
}
