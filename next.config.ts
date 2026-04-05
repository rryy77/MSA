import type { NextConfig } from "next";
import path from "path";

/**
 * 親ディレクトリに別の package-lock があると Turbopack が誤ったルートを選ぶ。
 * `npm run dev` / `build` はこのプロジェクト直下で実行する前提で cwd をルートにする。
 */
const nextConfig: NextConfig = {
  turbopack: {
    root: path.resolve(process.cwd()),
  },
};

export default nextConfig;
