export {};

declare global {
  interface Window {
    desktopInfo?: {
      isDesktop: boolean;
      platform?: string;
      versions?: Record<string, string>;
      homeDir?: string;
      workspaceDir?: string;
      beep?: () => Promise<boolean>;
      readImageFile?: (
        filePath: string,
      ) => Promise<{
        ok: boolean;
        error?: string;
        path?: string;
        mimeType?: string;
        size?: number;
        dataUrl?: string;
      }>;
      fetchImageUrl?: (
        url: string,
      ) => Promise<{
        ok: boolean;
        error?: string;
        mimeType?: string;
        size?: number;
        dataUrl?: string;
      }>;
      setGatewayUrl?: (
        url: string,
      ) => Promise<{
        ok: boolean;
        remote?: boolean;
        candidates?: number;
      }>;
    };
  }
}
