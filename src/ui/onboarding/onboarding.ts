/**
 * Welcome page. In Firefox, host permissions requested by MV3 extensions are
 * opt-in, so we check for them and offer a button to grant them.
 */
const ALL_SITES: chrome.permissions.Permissions = { origins: ['<all_urls>'] };

async function main(): Promise<void> {
  const section = document.getElementById('permission') as HTMLElement;
  const button = document.getElementById('grant') as HTMLButtonElement;
  const granted = await chrome.permissions.contains(ALL_SITES);
  section.hidden = granted;
  button.addEventListener('click', async () => {
    // permissions.request must be called directly from the click handler.
    if (await chrome.permissions.request(ALL_SITES)) section.hidden = true;
  });
}

void main();
