# Réorganisation desktop des menus

## Objectif

Éviter les rangées presque vides sur desktop après déduplication des menus mis en avant. Conserver le comportement mobile validé et le langage visuel existant.

## Périmètre

- Desktop : largeur de viewport à partir de 1080 px, breakpoint existant des cinq colonnes.
- En dessous : conserver le regroupement par semaine et les grilles actuelles.
- Aucun changement de données, de palette, de tri métier ou de publication.

## Composition

1. Conserver la rangée des deux grandes cartes et son asymétrie.
2. Répartir les cartes restantes de la semaine courante sur toute la largeur à parts égales : une carte pleine largeur, deux à 50/50, trois à un tiers. Conserver les headers colorés et les corps blancs. Ne pas rendre une section vide.
3. Conserver les semaines futures avec leurs titres surlignés et leur grille de cinq jours.
4. Après retour utilisateur, conserver une section par semaine dans les archives desktop sous « Anciens menus », avec titre et lien « menu complet ». Pour une à trois cartes, utiliser une grille de trois colonnes ; quatre ou cinq cartes remplissent la ligne avec autant de colonnes.
5. Conserver l'ordre actuel des archives : semaines de la plus récente à la plus ancienne, puis jours croissants à l'intérieur de chaque semaine. Ne pas utiliser de placement CSS qui modifie l'ordre de lecture.
6. Conserver les dates sur les cartes et un accès identifiable aux images originales du jour et de la semaine dans les headers hebdomadaires.

## Contraintes d'implémentation

- Préférer un DOM partagé entre desktop et mobile ; éviter de dupliquer les menus.
- Aucun contrôle invisible ne doit rester dans le parcours clavier.
- Identifiants de lightbox uniques et retour du focus au contrôle d'origine.
- Préserver le contenu intégral des repas et les couleurs attachées au jour, indépendantes de la position.
- Préserver cadres, ombres décalées et espace nécessaire autour de ces ombres.
- Corriger le défaut résiduel : un jour explicitement fermé ne doit pas afficher « Menu non renseigné ».

## Vérifications et revue

- Cas du 8 septembre 2026 : mardi/mercredi en tête, jeudi/vendredi sur toute la deuxième rangée, semaine du 14 complète, lundi 7 sur un tiers de la largeur dans sa section d'archives, puis semaine antérieure dans sa propre section.
- Vérifier une, deux et trois cartes restantes, une seule archive, aucune archive et aucune semaine à venir.
- Vérifier mobile, tablette et desktop, ainsi que le passage du breakpoint.
- Vérifier absence de perte/duplication de jours, contenu intégral, ordre, accès aux images et identifiants uniques.
- Vérifier le rendu d'un jour fermé et celui d'un menu non renseigné séparément.
- Reconstruire la prévisualisation locale avec le JSON récent déjà récupéré.
- Revue indépendante du parent après l'implémentation Terra. Rapporter explicitement toute limite de validation visuelle.
- Aucun commit ou push dans cette étape.
