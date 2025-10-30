# Admin mobil sidebar – çift tetikleme ve kapatma davranışı

Tarih: 2025-10-24

## Belirti
- `.sidebar-toggle` tıklandığında tek tıklamada iki log oluşuyordu (opened → closed) ve sidebar açılıp kapanıyordu.
- Menüde `.menu-item` tıklanınca sidebar kapanmıyordu.

## Kök Neden
- `.sidebar-toggle` için çift event binding (iki farklı yerde click bağlama) nedeniyle `toggleSidebar()` ardışık çalıştı.
- CSS/JS tarafında `.show`/`.open` ve `transform` kullanımında karışıklık potansiyeli vardı.

## Çözüm
- Tekil event binding: Toggle click tek bir yerde bırakıldı (veya HTML `onclick` tekil hale getirildi).
- Mobilde açık/kapalı durumları için `.open` sınıfı ile birlikte inline `transform` zorlandı:
  - Aç: `translateX(0%)`
  - Kapat: `translateX(-100%)`
- Menü öğesi tıklanınca otomatik kapanma: `.menu-item` click → mobilde `closeSidebar()` çağrısı.

## İlgili Dosyalar
- `espfrontend/public/scripts/admin.js`

## Doğrulama
1) Responsive mod (≤768px) → `.sidebar-toggle` tek tık = tek log, sidebar doğru aç/kapa.
2) Sidebar açıkken herhangi bir `.menu-item` → sidebar kapanır, overlay gizlenir.
3) Desktop (>768px) → sidebar görünür, toggle etkisizdir.
