# 🎟️ Beitar Jerusalem Ticket Monitor

מערכת מעקב אחר כרטיסים למשחקי בית"ר ירושלים עם התראות SMS ואימייל.

## 🚀 מבנה הפרויקט

```
beitar-ticket-monitor/
├── extension/           # Chrome Extension
│   ├── manifest.json
│   ├── popup.html/js/css
│   ├── background.js
│   ├── content.js/css
│   └── icons/
└── server/              # Notification Server
    ├── server.js
    ├── package.json
    └── .env.example
```

## 📦 התקנת התוסף

### שלב 1: הכנת התוסף

1. פתח את Chrome ועבור ל: `chrome://extensions/`
2. הפעל "Developer mode" (מצב מפתח) בפינה הימנית העליונה
3. לחץ על "Load unpacked" (טען לא ארוז)
4. בחר את התיקייה `extension`

### שלב 2: שימוש בתוסף

1. **הוספת משחקים למעקב:**
   - גלוש ל-[beitarfc.co.il/משחקים](https://www.beitarfc.co.il/%D7%9E%D7%A9%D7%97%D7%A7%D7%99%D7%9D/)
   - לחץ על כפתור "עקוב אחרי כרטיסים" ליד כל משחק

2. **צפייה במשחקים במעקב:**
   - לחץ על אייקון התוסף בסרגל הכלים
   - תראה רשימת משחקים עם סטטוס כרטיסים

3. **הגדרת התראות:**
   - התראות דפדפן: מופעלות אוטומטית
   - התראות שרת (SMS/Email): הפעל והגדר בתוסף

## 🖥️ התקנת שרת ההתראות

### שלב 1: התקנת תלויות

```bash
cd server
npm install
```

### שלב 2: הגדרת משתני סביבה

```bash
cp .env.example .env
```

ערוך את קובץ `.env`:

#### הגדרת אימייל (Gmail)

```env
EMAIL_SERVICE=gmail
EMAIL_USER=your-email@gmail.com
EMAIL_PASS=your-app-password
```

**להפקת App Password ב-Gmail:**
1. עבור ל-[Google Account Security](https://myaccount.google.com/security)
2. הפעל אימות דו-שלבי
3. צור App Password חדש

#### הגדרת SMS (Twilio)

```env
TWILIO_ACCOUNT_SID=your-account-sid
TWILIO_AUTH_TOKEN=your-auth-token
TWILIO_PHONE_NUMBER=+1234567890
```

**להרשמה ל-Twilio:**
1. צור חשבון ב-[twilio.com](https://www.twilio.com/)
2. קבל מספר טלפון חינמי (Trial)
3. העתק את ה-SID וה-Auth Token

### שלב 3: הפעלת השרת

```bash
npm start
```

השרת יפעל ב-`http://localhost:3000`

### שלב 4: חיבור התוסף לשרת

1. פתח את התוסף
2. הפעל "התראות שרת"
3. הזן את כתובת השרת: `http://localhost:3000`
4. הזן אימייל ו/או מספר טלפון
5. לחץ "שמור"

## 🔌 API Endpoints

| Method | Endpoint | תיאור |
|--------|----------|--------|
| GET | `/api/health` | בדיקת סטטוס שרת |
| POST | `/api/subscribe` | הרשמה להתראות |
| POST | `/api/notify` | שליחת התראה |
| POST | `/api/test-email` | בדיקת אימייל |
| POST | `/api/test-sms` | בדיקת SMS |

### דוגמת בקשה

```javascript
// שליחת התראה
fetch('http://localhost:3000/api/notify', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    email: 'user@example.com',
    phone: '0501234567',
    games: [{
      name: 'בית"ר ירושלים נגד הפועל חיפה',
      date: '2024-01-15T19:00:00',
      price: 50,
      url: 'https://leaan.co.il/event/12345'
    }]
  })
});
```

## ⚙️ הגדרות נוספות

### תדירות בדיקה

ניתן לשנות את תדירות הבדיקה בתוסף (ברירת מחדל: 5 דקות)

### מצב ייצור

לשימוש בייצור, מומלץ:
1. להריץ את השרת עם PM2 או Docker
2. להשתמש במסד נתונים אמיתי (MongoDB/Redis) במקום in-memory
3. להוסיף אימות API

## 🐛 פתרון בעיות

### התוסף לא מזהה משחקים
- ודא שאתה בדף המשחקים של beitarfc.co.il
- רענן את הדף
- בדוק את Console של הדפדפן לשגיאות

### לא מתקבלות התראות אימייל
- בדוק את הגדרות Gmail (App Password)
- בדוק את תיקיית הספאם
- השתמש ב-`/api/test-email` לבדיקה

### לא מתקבלות התראות SMS
- ודא שמספר הטלפון מאומת ב-Twilio
- בחשבון Trial, רק מספרים מאומתים יכולים לקבל SMS
- בדוק את לוג השרת לשגיאות

## 📄 רישיון

MIT License
