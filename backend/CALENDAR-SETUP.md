# إعداد Google Calendar لعقل

هذه الخطوات لصاحب المشروع، مرة واحدة. لا تضع Client Secret أو مفتاح التشفير في
الواجهة أو المحادثة أو متغيرات VITE، ولا ترفعها إلى Git.

## 1. مشروع Google

1. افتح https://console.cloud.google.com/ وسجّل الدخول بحساب Google الذي ستختبر به.
2. من محدد المشاريع أعلى الصفحة اختر **New project**، وسمّه `AQL Assistant`.
3. من **APIs & Services → Library** ابحث عن **Google Calendar API** واضغط **Enable**.
4. افتح **Google Auth Platform** واضغط **Get started**. اكتب اسم التطبيق وبريد الدعم
   وبريد التواصل. اختر **External** إذا لم يكن المشروع محصورًا بمؤسسة Workspace.
5. من **Audience** أبقِ التطبيق في وضع **Testing** وأضف بريد حسابك في **Test users**.
6. من **Data Access** أضف النطاق:
   `https://www.googleapis.com/auth/calendar.events.owned`

## 2. عميل الويب ورابط العودة

1. من **Clients → Create client** اختر **Web application**.
2. أضف إلى **Authorized redirect URIs** الرابط التالي بعد استبدال النطاق بعنوان
   خادم backend المنشور لديك (Render مثلًا)، وليس عنوان Vercel للواجهة:

   `https://YOUR-BACKEND.example/api/calendar/callback`

   للتجربة المحلية يمكن إضافة `http://localhost:5000/api/calendar/callback` أيضًا.
   يجب أن يطابق الرابط قيمة GOOGLE_REDIRECT_URI حرفيًا، دون شرطة مائلة إضافية.
3. احتفظ بـ **Client ID** و**Client secret** في إعدادات الخادم فقط.

## 3. Supabase ومتغيرات الخادم

1. من Supabase **SQL Editor** افتح استعلامًا جديدًا والصق محتوى
   `backend/migrations/calendar.sql` ثم شغّله مرة واحدة. الجداول مغلقة أمام الواجهة؛
   الخادم يستعمل مفتاح service role الموجود أصلًا في المشروع.
2. ولّد مفتاح تشفير على جهازك من الطرفية باستخدام:

   ```powershell
   node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
   ```

3. أضف متغيرات البيئة الآتية إلى backend في Render، أو إلى `.env` للتجربة المحلية:

   ```dotenv
   GOOGLE_CLIENT_ID=YOUR_CLIENT_ID
   GOOGLE_CLIENT_SECRET=YOUR_CLIENT_SECRET
   GOOGLE_REDIRECT_URI=https://YOUR-BACKEND.example/api/calendar/callback
   APP_URL=https://aql-os-orcin.vercel.app
   CALENDAR_TOKEN_KEY=YOUR_GENERATED_BASE64_KEY
   ```

   احتفظ بمفتاح التشفير نفسه عند إعادة النشر؛ تغييره يجعل الاتصالات القديمة غير قابلة
   للقراءة وتحتاج إعادة الربط. لا تحتاج هذه الميزة صلاحيات Gmail أو Drive.
4. انشر تحديث backend وfrontend، وأعد تشغيل الخادم بعد ضبط المتغيرات.

## 4. الاستخدام والاختبار

من عقل افتح **تقويمي → اربط Google Calendar** ثم اختر حساب الاختبار ووافق على
الصلاحية. ستعود للواجهة وتظهر مواعيد تقويمك الأساسي للأسبوعين القادمين.
أنشئ موعدًا تجريبيًا، راجع العنوان والبداية والنهاية والمنطقة الزمنية، ثم أكّد الحفظ.
افتح Google Calendar وتحقق منه. لا تُضاف دعوات أو ضيوف من هذه الواجهة.
زر **افصل الحساب وألغِ الإذن** يلغي وصول Google ويحذف الرموز المحلية.

النسخة الحالية تعرض المواعيد وتنشئها فقط؛ تعديلها وحذفها وGoogle Tasks ليست مضافة بعد.
بيانات التقويم لا تُرسل تلقائيًا إلى الذكاء الاصطناعي.

## ملاحظات التشغيل

- وضع Testing في Google قد يجعل refresh token ينتهي بعد 7 أيام لهذا النوع من
  الصلاحيات؛ أعد الربط أثناء التطوير. الانتقال لاستخدام عام قد يتطلب تحقق Google
  بحسب النطاقات والجمهور. لا تتجاوز شاشة التحذير لتطبيق لا تملكه.
- `redirect_uri_mismatch`: راجع التطابق الحرفي بين رابط العودة في Google ومتغير الخادم.
- `access_denied`: تأكد أن الحساب مضاف في Test users، ثم ابدأ الربط من عقل مجددًا.
- «التخزين غير متاح» أو فشل الربط رغم صحة المفاتيح: تأكد من تشغيل ملف SQL ووجود
  مفتاح Supabase service role الصحيح في backend.
- نظّف صفوف OAuth المنتهية دوريًا:
  `delete from public.calendar_oauth_states where expires_at < now();`
- رموز Google مشفرة AES-256-GCM وتُحفظ في Supabase، ولا تصل إلى المتصفح. حالة
  OAuth أحادية الاستعمال مع cookie ربط HttpOnly ومدة صلاحية 10 دقائق.

المراجع الرسمية: [إعداد Calendar API](https://developers.google.com/workspace/calendar/api/quickstart/nodejs)،
[OAuth لتطبيقات الويب](https://developers.google.com/identity/protocols/oauth2/web-server).
