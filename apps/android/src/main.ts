import SafFile from './saf-file-plugin.js';

const textarea = document.querySelector<HTMLTextAreaElement>('#content');
const log = document.querySelector<HTMLPreElement>('#log');
const openBtn = document.querySelector<HTMLButtonElement>('#open');
const saveAsBtn = document.querySelector<HTMLButtonElement>('#save-as');
const shareBtn = document.querySelector<HTMLButtonElement>('#share');
const savePrivateBtn = document.querySelector<HTMLButtonElement>('#save-private');
const loadPrivateBtn = document.querySelector<HTMLButtonElement>('#load-private');

function appendLog(line: string): void {
  if (!log) return;
  const time = new Date().toISOString().slice(11, 19);
  log.textContent = `${log.textContent ?? ''}[${time}] ${line}\n`;
}

function getContent(): string {
  return textarea?.value ?? '';
}

openBtn?.addEventListener('click', () => {
  SafFile.openDocument()
    .then((result) => {
      if (textarea) textarea.value = result.content;
      appendLog(`opened: ${result.name}`);
    })
    .catch((error: unknown) => {
      appendLog(`open failed: ${String(error)}`);
    });
});

saveAsBtn?.addEventListener('click', () => {
  SafFile.createDocument({ suggestedName: 'config.yaml', content: getContent() })
    .then((result) => {
      appendLog(`saved as: ${result.name}`);
    })
    .catch((error: unknown) => {
      appendLog(`save failed: ${String(error)}`);
    });
});

shareBtn?.addEventListener('click', () => {
  SafFile.shareText({ content: getContent(), filename: 'config.yaml' })
    .then(() => {
      appendLog('share sheet opened');
    })
    .catch((error: unknown) => {
      appendLog(`share failed: ${String(error)}`);
    });
});

savePrivateBtn?.addEventListener('click', () => {
  SafFile.writePrivate({ filename: 'snapshot.yaml', content: getContent() })
    .then((result) => {
      appendLog(`private write ok: ${result.path}`);
    })
    .catch((error: unknown) => {
      appendLog(`private write failed: ${String(error)}`);
    });
});

loadPrivateBtn?.addEventListener('click', () => {
  SafFile.readPrivate({ filename: 'snapshot.yaml' })
    .then((result) => {
      if (textarea) textarea.value = result.content;
      appendLog('private read ok');
    })
    .catch((error: unknown) => {
      appendLog(`private read failed: ${String(error)}`);
    });
});
