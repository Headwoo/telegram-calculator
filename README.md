# Balance

Balance is a Telegram Mini App with three English-language calculators and a light and dark interface.

- **Growth** estimates compound interest using a nominal annual return, monthly compounding and end-of-month contributions.
- **Budget** shows spending by category and how much monthly take-home pay remains after expenses.
- **Split** uses the same take-home pay and expenses. It plans at least 10% of take-home pay for stock-market investing and 10% for HISA / HYSA. Any remainder goes to the emergency fund. When the plan exceeds income, it shows the shortfall and a $0 emergency contribution.

The app starts with the approved sample amounts in USD. Edits and theme preferences are saved in local browser storage. Balance performs calculations on the device and does not send the entered amounts to the bot. On the first visit, the theme follows Telegram or the browser.

## Preview locally

From this folder, start a static server with Python 3.

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

Open [localhost:8000](http://127.0.0.1:8000/) in a browser.

## Launch from Telegram

1. Publish `index.html`, `styles.css`, `app.js` and `finance.mjs` together on a static HTTPS host. The host should serve both JavaScript files with a JavaScript MIME type. Open the public HTTPS URL in a browser and check that the calculator loads.
2. Create a bot using `/newbot` in [@BotFather](https://t.me/BotFather). Open your bot under `/mybots`, go to **Bot Settings → Configure Mini App**, and enable the main Mini App with your public HTTPS URL.
3. Open the bot’s profile in Telegram and tap its app launch button. To add a launcher inside the bot chat, use `/setmenubutton` in BotFather with the same URL.

The static app requires no bot token or backend. Telegram controls the native header and safe areas.

[Telegram Mini Apps documentation](https://core.telegram.org/bots/webapps#launching-the-main-mini-app)
