# Hesap Takip

Restoranda herkesin yediği içtiği şeyleri kolayca takip edebileceği gerçek zamanlı web uygulaması.

## Kurulum

```bash
npm install
npm start
```

Uygulama `http://localhost:3000` adresinde çalışır.

## Teknolojiler

- Node.js + Express
- Socket.io
- HTML / CSS / JavaScript

---

## v1.0 — Temel Uygulama

- Masa oluşturma ve paylaşma (6 haneli kod ile)
- Session'a isim girerek katılma
- Kişi bazlı ürün ekleme ve silme
- Aynı ürün eklenince adet artırma
- Daha önce girilen ürünlerin önerilmesi ve fiyat otomatik doldurma
- Socket.io ile gerçek zamanlı güncelleme
- Kişi bazlı toplam ve genel toplam hesaplama
- Fiyat girişi opsiyonel

## v1.1 — İyileştirmeler

- Paylaş butonu URL üretiyor, mobilde native paylaş menüsü açılıyor
- Ürün satırlarında +/- butonları ile adet artırma/azaltma
- Mobil uyumlu öneri dropdown'ı (Android Firefox desteği)
- Ürün ekleme alanı iki satıra ayrıldı (mobilde daha rahat kullanım)
- Sayfa yenilenince otomatik yeniden katılma (localStorage + token ile oturum koruması)
- Token bazlı kullanıcı doğrulama (başka cihazdan aynı isimle giriş engellenir)
- Fiyat kutusuna sadece rakam girişi
- Yeni Masa butonu
- Railway deploy desteği

## v1.2 — Masa Modları ve Kararlı Oturumlar

- 4 farklı masa modu: Standart, Yönetici, Anonim, Hibrit
- Masa sahibi kişi ekleme yetkisi (+ butonu ile toggle)
- Başkasına ürün ekleme (Kime? dropdown ile hedef kullanıcı seçimi)
- Yönetici badge (Y) ve mod badge (tooltip ile açıklama)
- Header yeniden tasarlandı: ikon butonlar, kompakt düzen, ₺ logosu
- Session'lar dosyaya kaydediliyor (sunucu restart'a dayanıklı)
- Cookie + localStorage ile çift katmanlı oturum koruması
- Socket.io auth middleware ile otomatik yeniden bağlanma
- PWA desteği: ana ekrana eklenebilir, offline cache
