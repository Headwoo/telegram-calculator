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
