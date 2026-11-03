import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // T-290: o middleware lê o corpo das requisições até 10 MB por padrão; o envio de áudio e arquivos do WhatsApp aceita até 16 MB.
  experimental: { proxyClientMaxBodySize: "17mb" },
};

export default nextConfig;
