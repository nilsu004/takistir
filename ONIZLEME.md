# Takıştır frontend önizlemesi

Bu sürüm, Takıştır projesinin örnek verilerle çalışan müşteri arayüzüdür. Backend API'lerine veya veritabanına bağlanmadan incelenebilir.

## Açılış

Projenin ana klasörünü Terminal'de aç. İlk kurulumda bağımlılıkları yükle:

```sh
npm ci
```

Önizlemeyi başlat:

```sh
npm run dev --workspace frontend -- --port 5174
```

Tarayıcıda <http://127.0.0.1:5174> adresini aç. Sunucuyu durdurmak için `Ctrl+C` kullan. Frontend değişiklikleri otomatik olarak yansır.

## Neleri inceleyebilirsin?

- Ana sayfa, kategori listesi, isim/açıklama arama, fiyat/popülerlik sıralaması.
- Ürün detayı, stock bilgisi, quantity seçimi, wishlist ve cart.
- Login / registration görünümü; **Use demo account** ile şifre yazmadan devam edebilirsin.
- Delivery address → mock payment → order confirmation → invoice.
- Payment sayfasındaki **Preview payment error** bölümünden başarısız ödeme görünümü.
- Profile, order history; Processing siparişi iptal etme, Delivered siparişin seçili ürün ve adetleri için return request.
- Teslim edilmiş örnek alışverişin ürününde rating / review formu.
- Live chat görünümü; örnek mesajlar ve dosya adı önizlemesi.
- Telefon genişliğine uyarlanan yerleşim.

Başlangıç sepetinde iki ürün var. Orders sayfasında üç örnek sipariş var; bu sayede farklı durumları deneyebilirsin. İade örnekleri için kullanılan tarih **1 November 2026**.

## Bu sürümün sınırı

Bu bir **frontend inceleme sürümü**. Gerçek kullanıcı doğrulama, database, ödeme, email, dosya yükleme, gerçek zamanlı chat ve manager panelleri bağlanmadı. Parola ve kart alanları saklanmaz veya sunucuya gönderilmez. Cart ve wishlist tarayıcının localStorage alanında kalır; diğer değişiklikler sayfa yenilenince sıfırlanır.

Figma'nın **Home** ve **Product details** ekranlarından tasarım bilgisi ve özgün SVG görseller alındı. Diğer ekranları okurken Figma araç kotası doldu; ek akışlar aynı renk/font/component diliyle kodlandı. Dolayısıyla bu çalışma tüm Figma ekranlarının birebir aktarımı değildir.

## Kod nerede?

| Dosya                         | İçerik                                            |
| ----------------------------- | ------------------------------------------------- |
| `frontend/src/App.jsx`        | Sayfa yönlendirmesi                               |
| `frontend/src/components.jsx` | Header, footer, product card, form alanları, chat |
| `frontend/src/Storefront.jsx` | Home, catalog, product, cart, wishlist            |
| `frontend/src/Checkout.jsx`   | Delivery, payment, confirmation                   |
| `frontend/src/Account.jsx`    | Login, profile, orders, return request, invoice   |
| `frontend/src/Store.jsx`      | Ortak demo state ve işlemler                      |
| `frontend/src/data.js`        | Örnek ürünler ve siparişler                       |
| `frontend/src/styles.css`     | Renkler, fontlar, desktop / mobile stilleri       |
| `frontend/public/assets/`     | Yerel SVG görseller ve fontlar                    |

Build kontrolü: `npm run build`.
