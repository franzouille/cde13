# cde13

Cache public GitHub Pages pour les menus de la Caisse des ecoles du 13e arrondissement de Paris.

Ce repo porte l'automatisation de recuperation, crop, OCR et publication du cache public.

Le workflow GitHub Actions recupere les menus publics CDE13, copie les images `menu-standard-du-*`, genere les crops par jour, OCRise ces crops, puis publie :

```text
index.html
styles.css
app.js
menus.json
menus/YYYY-MM-DD.jpg
menus/YYYY-MM-DD/lundi.jpg
menus/YYYY-MM-DD/mardi.jpg
menus/YYYY-MM-DD/mercredi.jpg
menus/YYYY-MM-DD/jeudi.jpg
menus/YYYY-MM-DD/vendredi.jpg
```

URL cible :

```text
https://franzouille.github.io/cde13/
https://franzouille.github.io/cde13/menus.json
```

## Lancer en local

Prerequis :

- Node.js
- npm

Installation :

```sh
npm install
```

Generation locale du cache :

```sh
PUBLIC_BASE_URL='https://franzouille.github.io/cde13/' npm run update-menu-cache
```

Generation locale de la page statique, apres le cache :

```sh
npm run build-web
```

Generation complete de l'artifact GitHub Pages :

```sh
PUBLIC_BASE_URL='https://franzouille.github.io/cde13/' npm run build-pages
```

Resultat attendu :

- generation de `dist/menu-cache/index.html`
- generation de `dist/menu-cache/menus.json`
- generation de `dist/menu-cache/styles.css` et `dist/menu-cache/app.js`
- generation des images sources dans `dist/menu-cache/menus/`
- generation des crops jour par jour dans `dist/menu-cache/menus/YYYY-MM-DD/`
- presence de `dayTexts` OCRises dans `menus.json`

Notes :

- `PUBLIC_BASE_URL` sert a fabriquer les URLs publiques dans `menus.json`.
- `update-menu-cache` genere uniquement le cache JSON/images.
- `build-web` copie seulement la page statique dans `dist/menu-cache`.
- En local, le script essaie d'abord de reutiliser le `menus.json` public existant pour eviter de retraiter les menus inchanges.
- Le dossier `dist/` est genere localement et ignore par Git.
- Le dossier `.cache/tesseract/` contient le cache OCR local et est ignore par Git.
- Point de vigilance debug : la page CDE13 peut changer le format des slugs d'images sans changer l'interface visible. Si des semaines manquent, inspecter le DOM rendu et les prefixes `menu-standard-du-*`, `menu-de-la-semaine-du-*` et `menus-*` avant de conclure que le site n'a rien de nouveau.

## GitHub Actions

Le workflow GitHub Actions fait la meme chose que le run local, puis publie `dist/menu-cache` sur GitHub Pages.
