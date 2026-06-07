import fs from "node:fs";
import path from "node:path";
import { claudeSkillsPath } from "./paths";

export interface SkillsInstallResult {
  installedNames: string[];
  changedFiles: number;
}

const SKILLS: Array<{ name: string; body: string }> = [
  {
    name: "context-compass-explore",
    body: `---
name: context-compass-explore
description: Önceden hesaplanmış davranışsal bağlamı kullanarak kod tabanında gezin ve onu anla. Kodu keşfederken, mimariyi anlarken, ilgili fonksiyonları bulurken veya herhangi bir kodlama görevine başlarken kullanın. Dosya okumanın gözden kaçırdığı modüller arası bağımlılık haritaları sağlar.
---

# Context Compass: Keşfet

Bu kod tabanını keşfederken veya anlarken, gezinme için dosya okumak yerine
Context Compass MCP araçlarını kullanın.

## İş Akışı

1. Modül haritasını, en sık değişen (hot) fonksiyonları ve önemli modüller arası
   bağlantıları görmek için \`get_project_overview\` aracını çağırarak başlayın.

2. Belirli bir görev için, görev açıklamanızla \`get_relevant_context\` aracını çağırın.
   Bu, alaka düzeyine göre sıralanmış fonksiyon paketlerini döndürür; içerir:
   - Birincil fonksiyonun tam kaynağı
   - Bağlı fonksiyonlar için imzalar ve ilişki açıklamaları
   - CO_EDIT bağlantıları: geçmişte birlikte değiştirilmiş fonksiyonlar
     (import/çağrı analizinde görünmez)

3. Belirli bir fonksiyon hakkında daha derin ayrıntıya ihtiyacınız varsa,
   fonksiyon adıyla \`get_function_bundle\` aracını çağırın.

4. Fonksiyonları ada veya anahtar kelimeye göre bulmak için \`search_functions\` kullanın.

5. Dosyaları yalnızca şu durumlarda doğrudan okuyun:
   - Tünellenmiş bir fonksiyonun tam uygulamasını görmek için (imzası pakette
     mevcut; tam gövdeye ihtiyacınız varsa dosyayı okuyun)
   - Kodu düzenlemek veya değiştirmek için (düzenlemeler için her zaman gerçek dosya gerekir)
   - Paketin tanımladığı bir şeyi doğrulamak için

## Önemli içgörü

Bu projenin indeksi CO_EDIT bağlantılarını içerir: git commit'lerinde geçmişte
birlikte düzenlenen ancak aralarında yapısal bir bağ (çağrı, import, kalıtım)
bulunmayan fonksiyon çiftleri. Bunlar, diğer her kod gezinme aracının gözden
kaçırdığı gerçek bağımlılıkları temsil eder. Paket çıktısındaki CO_EDIT tünellerine dikkat edin.
`
  },
  {
    name: "context-compass-review",
    body: `---
name: context-compass-review
description: Kod değişikliklerini davranışsal etki yarıçapı (blast radius) analiziyle incele. Diff'leri, PR'ları veya son değişiklikleri incelerken kullanın. Yapısal analizin gözden kaçırdığı modüller arası etkileri ortaya çıkarır.
---

# Context Compass: Değişiklikleri İncele

Kod değişikliklerini incelerken, davranışsal bağımlılıklar da dâhil olmak üzere
tam etkiyi bulmak için Context Compass'ı kullanın.

## İş Akışı

1. Değişen fonksiyonları belirleyin (diff'ten, hazırlanmış (staged) dosyalardan veya kullanıcı açıklamasından).

2. Her değişen fonksiyon için, bağlantılarını görmek üzere \`get_function_bundle\` aracını çağırın:
   - CALLS/CALLED_BY: yapısal bağımlılıklar (import'larda da görünür)
   - CO_EDIT: davranışsal bağımlılıklar (YALNIZCA Context Compass aracılığıyla görünür)
   - TEST: ilişkili test dosyaları

3. CO_EDIT bağlantıları kritik inceleme hedefleridir. A fonksiyonu değiştiyse ve
   B fonksiyonu güçlü bir CO_EDIT bağlantısıysa (yüksek PMI puanı), aralarında
   import veya çağrı olmasa bile B fonksiyonunun da incelenmesi muhtemelen gerekir.

4. Etkilenebilecek her şeyin önceliklendirilmiş bir listesini almak için tüm
   değişikliklerin bir özetiyle \`get_relevant_context\` aracını çağırın.

5. Etkilenen her fonksiyon için, değişikliğin paketin ilişki etiketlerinde
   tanımlanan beklenen arayüzü veya davranışı bozup bozmadığını kontrol edin.

## Nelere dikkat etmeli

- Değişikliğe dâhil edilmemiş CO_EDIT bağlantıları (olası gözden kaçırmalar)
- Değişen koda yüksek PMI puanı olan fonksiyonlar (güçlü davranışsal bağlaşım)
- Modüller arası etkiler (farklı dosya, farklı dizin, ama geçmişte birlikte düzenlenmiş)
`
  }
];

export function installContextCompassSkills(projectRoot: string): SkillsInstallResult {
  const root = claudeSkillsPath(projectRoot);
  fs.mkdirSync(root, { recursive: true });

  let changedFiles = 0;
  const installedNames: string[] = [];

  for (const skill of SKILLS) {
    const skillDir = path.join(root, skill.name);
    const filePath = path.join(skillDir, "SKILL.md");
    fs.mkdirSync(skillDir, { recursive: true });

    const next = ensureTrailingNewline(skill.body);
    const prev = fs.existsSync(filePath) ? fs.readFileSync(filePath, "utf8") : "";
    if (prev !== next) {
      fs.writeFileSync(filePath, next, "utf8");
      changedFiles += 1;
    }

    installedNames.push(skill.name);
  }

  return {
    installedNames,
    changedFiles
  };
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
