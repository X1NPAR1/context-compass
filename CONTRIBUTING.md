# Context Compass'a Katkıda Bulunma

Katkıda bulunduğunuz için teşekkürler. Bu proje, her PR için katı CI ve sürüm (release) kapıları uygular.

## Yerel Kurulum

1. Node.js `>=20` kurun.
2. Depoyu klonlayın ve bağımlılıkları yükleyin:

```bash
npm ci
```

3. Bir kez derleyin:

```bash
npm run build
```

## Buradan Başlayın (PR Öncesi Zorunlu)

Tam doğrulama paketini çalıştırın:

```bash
npm run ci:verify
```

Bu komut şunları çalıştırır:

- Typecheck (tür denetimi)
- Build (derleme)
- Birim testleri (coverage ile)
- Entegrasyon testleri
- CLI duman (smoke) testleri
- Sürüm kontrolleri (`audit` + `pack --dry-run`)

## Pull Request Beklentileri

- Değişiklikleri dar kapsamlı ve iyi açıklanmış tutun.
- Davranış değişiklikleri için test ekleyin veya güncelleyin.
- Kullanıcıya görünen davranış, komutlar veya iddialar değiştiğinde dokümanları/README'yi güncelleyin.
- Desteklenen tüm ortamlarda (Linux, macOS, Windows) CI'yı yeşil tutun.

## Test Rehberi

### Birim testleri

```bash
npm run test:unit
```

### Entegrasyon testleri

```bash
npm run test:integration
```

### Duman (smoke) testi

```bash
npm run test:smoke
```

### Tam sürüm kapısı

```bash
npm run release:check
```

## Dil Desteği İstekleri

Başka bir dil için ayrıştırıcı/indeksleme hedefine mi ihtiyacınız var? **Language request** (Dil isteği) şablonunu kullanarak bir GitHub issue açın.
