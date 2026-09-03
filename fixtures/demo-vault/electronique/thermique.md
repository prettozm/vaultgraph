# Comportement thermique

## Sources de chaleur internes

Deux sources principales de chaleur ont été identifiées dans le
boîtier : la dissipation de la résistance de limitation de courant
décrite dans `electronique/alimentation-led.md`, et
l'échauffement propre de la batterie pendant la charge rapide en
plein soleil. Ce document **précise et raffine** l'estimation de
dissipation donnée dans `electronique/alimentation-led.md` (0,6 watt
en continu) en la resituant dans le bilan thermique complet du
boîtier, plutôt que dans le seul cadre du circuit d'alimentation.

## Exposition solaire directe

Comme décrit dans le scénario d'exposition prolongée
(`cas-usage/scenarios.md`), le boîtier peut atteindre 55 °C en
surface lorsqu'il est laissé en plein soleil toute une journée. À
cette température, certaines chimies de batterie voient leur durée
de vie réduite significativement.

## Conséquence sur le choix de batterie

Cette contrainte thermique a pesé dans la décision initiale de
retenir une chimie LiFePO4, réputée plus tolérante à la chaleur que
d'autres chimies lithium, comme détaillé dans
`decisions/ADR-001-batterie.md`.

## Mesures de mitigation

Le boîtier intègre des ouïes d'aération passives et un matériau à
forte conductivité thermique sous la résistance de limitation, afin
d'évacuer la chaleur sans ventilateur actif, ce qui aurait consommé
de l'énergie et nui à l'autonomie.

## Points encore ouverts

Le comportement thermique en cas d'usage prolongé au-delà de 45 °C
ambiants n'a pas encore été testé en conditions réelles ; ce point
reste une zone d'incertitude qui recoupe certaines hypothèses
listées dans `hypotheses/hypotheses-ouvertes.md`.
