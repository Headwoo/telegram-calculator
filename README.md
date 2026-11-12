# Balance

Balance is a Telegram Mini App with three English-language calculators and a light and dark interface.

- **Growth** estimates compound interest using a nominal annual return, monthly compounding and end-of-month contributions.
- **Budget** shows spending by category and how much monthly take-home pay remains after expenses.
- **Split** uses the same take-home pay and expenses. It plans at least 10% of take-home pay for stock-market investing and 10% for HISA / HYSA. Any remainder goes to the emergency fund. When the plan exceeds income, it shows the shortfall and a $0 emergency contribution.

The app starts with sample amounts in USD. On the first visit, the theme follows Telegram or the browser.

## Personal budgets and saving

Inside Telegram, the Mini App automatically uses the current Telegram user's single profile. There is no profile picker. The local cache is scoped to that user's numeric Telegram ID, and Telegram CloudStorage (Telegram 6.9+) restores the budget on another device using the same account and bot. Open the app through the bot's Mini App button so Telegram supplies the user identity.

Income, category names and amounts, added categories, investment percentage, projection inputs, theme, and the selected calculator are saved. Budget and Split edits are committed with **Done**; **Cancel** discards the open editor's changes. In **Budget → Edit**, rename existing categories or select **+ Add category**. Names support up to 64 characters, with up to 100 categories per profile. Custom categories contribute to both the spending chart and the paycheck split.

The status beside the profile shows whether changes are saved in Telegram or are waiting to sync. Changes are cached immediately on the device; cloud writes are debounced, serialized, and retried when connectivity returns, the app resumes, and periodically while it remains open. An interrupted cloud write retains the preceding complete budget. Offline changes use the last edit time to resolve conflicts when Telegram becomes available. Avoid editing the same profile on multiple devices simultaneously. Data is sent to Telegram CloudStorage for sync; calculations still run on the device, without a separate budget server.

On a device with no saved budget, editing waits for the first successful Telegram read. If that read fails, reconnect and select **Retry**. This prevents the sample values from replacing a budget that already exists in Telegram. Devices with an existing cache can continue editing offline.

Existing `balance.settings.v1` browser data is migrated once into the first profile that opens it, preserving the original amounts. Other Telegram IDs start independently. Outside Telegram, the app uses a separate browser-only budget; it cannot sync without a Telegram identity. Browsers that deny local storage can still use Telegram CloudStorage when available. Older Telegram clients save locally and should be updated for cross-device sync.

Tapping outside an input dismisses the keyboard, including inside the budget editor. Tapping an input or its label still focuses it normally.

## Preview locally

From this folder, start a static server with Python 3.

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open [localhost:8000](http://127.0.0.1:8000/) in a browser.

Run persistence and migration checks with Node.js 20+:

```sh
node --test tests/*.test.mjs
```
