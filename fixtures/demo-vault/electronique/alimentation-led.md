# Alimentation de la LED

## Circuit d'alimentation

La LED de puissance choisie pour Lumen fonctionne sous un courant
nominal de 350 mA. Le circuit d'alimentation régule ce courant à
partir de la tension délivrée par la batterie, qui varie selon l'état
de charge.

## Résistance de limitation de courant

Pour protéger la LED contre les surintensités, une **résistance de
limitation** est placée en série sur le circuit. Sa valeur, calculée
à partir de la différence entre la tension de la batterie et la
tension de seuil de la LED, est d'environ 4,7 ohms dans le
prototype actuel. Cette résistance dissipe une partie de l'énergie
sous forme de chaleur, ce qui alimente directement les
considérations développées dans `electronique/thermique.md`.

## Dissipation thermique de la résistance

La puissance dissipée par cette résistance, de l'ordre de 0,6 watt
en fonctionnement continu, doit être évacuée par le boîtier sans
faire grimper excessivement la température interne. C'est un facteur
pris en compte dans le choix de la batterie (voir
`decisions/ADR-001-batterie.md`), certaines chimies supportant moins
bien la chaleur ambiante que d'autres.

## Alternative envisagée

Une alternative au régulateur linéaire avec résistance de limitation
serait un régulateur à découpage, plus efficace mais plus coûteux et
plus complexe à intégrer dans un boîtier aussi compact. Cette
alternative n'a pas été retenue pour la première version du produit.

## Lien avec le besoin d'autonomie

Le rendement du circuit d'alimentation, y compris les pertes dans la
résistance de limitation, a un impact direct sur l'autonomie
perçue par l'utilisateur, décrite comme besoin prioritaire dans
`besoins/utilisateurs.md`.
