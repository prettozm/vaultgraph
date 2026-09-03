# Besoins utilisateurs

## Besoin d'autonomie prolongée

Les utilisateurs cibles vivent souvent dans des zones où plusieurs
jours nuageux consécutifs sont fréquents. Le besoin exprimé lors des
entretiens terrain est clair : la lampe doit fournir un éclairage
utilisable pendant au moins trois nuits sans recharge solaire, même
en cas de charge initiale partielle. Ce besoin d'autonomie oriente
directement le choix de la batterie décrit dans
`decisions/ADR-001-batterie.md`.

## Besoin de simplicité d'usage

Un second besoin, tout aussi fort, est l'absence totale de réglage
technique : un bouton unique doit suffire à allumer, éteindre et
faire varier l'intensité lumineuse. Ce besoin découle des entretiens
menés auprès d'utilisateurs peu familiers de l'électronique, décrits
dans `contexte/projet-lumen.md`.

## Besoin de robustesse thermique

Les utilisateurs signalent que leurs équipements électroniques
tombent souvent en panne après une exposition prolongée à la
chaleur. La lampe doit donc continuer de fonctionner correctement
même lorsque le boîtier atteint des températures élevées en plein
soleil, ce qui est traité en détail dans `electronique/thermique.md`.

## Besoin d'un prix accessible

Enfin, un besoin de nature financière a été exprimé de façon répétée
lors des entretiens : le prix doit rester perçu comme raisonnable par
des foyers à revenu modeste. Ce besoin est au cœur de l'analyse
menée dans `finance/prix-et-marche.md` et de la décision prise dans
`decisions/ADR-002-prix-de-lancement.md`.

## Synthèse

Ces quatre besoins — autonomie, simplicité, robustesse thermique et
prix accessible — sont les fondations à partir desquelles les
scénarios d'usage (`cas-usage/scenarios.md`) et les fonctionnalités
du produit ont été dérivés.
