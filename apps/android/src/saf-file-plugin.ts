import { registerPlugin } from '@capacitor/core';

export interface SafFilePlugin {
  openDocument(): Promise<{ name: string; content: string }>;
  createDocument(options: { suggestedName: string; content: string }): Promise<{ name: string }>;
  shareText(options: { content: string; filename: string }): Promise<void>;
  writePrivate(options: { filename: string; content: string }): Promise<{ path: string }>;
  readPrivate(options: { filename: string }): Promise<{ content: string }>;
}

const SafFile = registerPlugin<SafFilePlugin>('SafFile');

export default SafFile;
