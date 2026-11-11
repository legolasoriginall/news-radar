# زمان‌بندی پایدار (وقتی cron گیت‌هاب اجرا نمی‌شود)

در چند بحث رسمی گیت‌هاب گزارش شده که تریگر `schedule` روی بعضی مخزن‌ها هرگز اجرا نمی‌شود،
در حالی که `workflow_dispatch` و push سالم‌اند. گردش‌کار این مخزن هر دو تریگر را دارد؛
برای اینکه به‌روزرسانی هر ۱۵ دقیقه تضمینی باشد، یکی از این دو راه را فعال کنید.

## راه ۱ — سرویس رایگان cron خارجی (پیشنهادی)

1. یک توکن گیت‌هاب بسازید: Settings → Developer settings → Personal access tokens →
   Fine-grained token → دسترسی به این مخزن با مجوز **Actions: Read and write**.
2. در [cron-job.org](https://cron-job.org) رایگان ثبت‌نام کنید و یک کار بسازید:
   - URL: `https://api.github.com/repos/<owner>/news-radar/actions/workflows/update.yml/dispatches`
   - Method: `POST`
   - Headers:
     - `Authorization: Bearer <TOKEN>`
     - `Accept: application/vnd.github+json`
     - `Content-Type: application/json`
   - Body: `{"ref":"main"}`
   - بازه: هر ۱۵ دقیقه
3. متن پاسخ موفق: `204 No Content`.

## راه ۲ — زمان‌بند ویندوز (بدون سرویس خارجی)

```powershell
# یک‌بار اجرا کنید (توکن را از فایل می‌خواند)
cd scheduler
$env:NEWS_RADAR_GH_TOKEN = "ghp_..."   # یا در فایل token.txt کنار اسکریپت بگذارید
.\trigger-update.ps1
```

برای اجرای خودکار هر ۱۵ دقیقه:

```powershell
schtasks /Create /SC MINUTE /MO 15 /TN "NewsRadar-Update" ^
  /TR "powershell -NoProfile -ExecutionPolicy Bypass -File \"%CD%\trigger-update.ps1\"" /F
```

نکته: این روش فقط وقتی رایانه روشن است اجرا می‌شود.

## راه ۳ — صبر برای رفع باگ

تریگر `schedule` در فایل گردش‌کار باقی مانده است؛ اگر گیت‌هاب مشکل را برطرف کند،
خودکار فعال می‌شود و نیازی به راه‌های بالا نیست.
