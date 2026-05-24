# cde13

Cache public GitHub Pages pour les menus de la Caisse des ecoles du 13e arrondissement de Paris.

Le workflow GitHub Actions recupere les menus publics CDE13, copie les images `menu-standard-du-*`, puis publie :

```text
menus.json
menus/YYYY-MM-DD.jpg
```

URL cible :

```text
https://franzouille.github.io/cde13/menus.json
```

## Commandes

```sh
npm install
PUBLIC_BASE_URL='https://franzouille.github.io/cde13/' npm run update-menu-cache
```

Le dossier `dist/` est genere localement et ignore par Git.
