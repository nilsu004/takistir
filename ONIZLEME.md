# Takıştır yerel ön izleme

Node.js 24+ ile proje ana klasöründe:

```sh
npm ci
npm run dev
```

`http://127.0.0.1:5173` adresini aç. Frontend ve API birlikte çalışmalıdır; yalnız frontend artık bağımsız demo veri kaynağı kullanmaz.

## Müşteri ve yönetici girişi

**My account → Local test accounts** bölümünden müşteri veya Product Manager test hesabını seç. İki rolü aynı anda denemek için normal pencere ile gizli pencereyi veya ayrı tarayıcı profillerini kullan; normal sekmeler oturum çerezini paylaşır.

| Hesap           | E-posta                | Parola          |
| --------------- | ---------------------- | --------------- |
| Customer        | deniz@example.com      | CustomerDemo!24 |
| Product Manager | manager@takistir.local | ManagerDemo!24  |

Yönetici girişinden sonra panel açılır. Panelden **View storefront**, müşteri görünümünden yetkili hesapla **Management panel** bağlantıları kullanılabilir. Katalog, stok, sipariş durumu ve yorum onayları ortak API'den gelir; diğer oturumlar yaklaşık üç saniyede güncellenir. Veriler `backend/data/local.sqlite` içinde kalır ve yeniden başlatmada korunur. Veritabanı Git'e gönderilmez.

## İncelenebilen akışlar

Müşteri tarafında katalog/arama/sıralama, ürün detayları, sepet/wishlist, giriş/kayıt/profil, mock checkout, sipariş geçmişi, iptal/iade talebi, teslim edilen ürün yorumu ve fatura görünümü bulunur. Product Manager tarafında ürün/kategori/stok yönetimi, sipariş/teslimat ve yorum moderasyonu vardır. Yeni ürünler Sales Manager fiyat atamasını bekler.

Gerçek ödeme alınmaz. Kart numarası ve güvenlik kodu API'ye gönderilmez. Gerçek kargo, e-posta/PDF fatura servisi, refund işlemi, Sales Manager ve Support Agent backend akışları kapsam dışıdır. Live chat mevcut frontend demosudur. Local SQLite adaptörü PostgreSQL şemasına bağlı değildir; production modunda başlatılamaz.

Figma'nın Home ve Product details ekranlarının tasarım dili korunmuştur. Diğer müşteri ekranları aynı renk/font/bileşen yaklaşımıyla hazırlanmıştır; tüm Figma ekranlarının birebir aktarımı değildir.

Test: `npm run check`. Ayrıntılı senaryo ve sınırlar: `PRODUCT_MANAGER_DEMO.md`, `backend/README.md`.
