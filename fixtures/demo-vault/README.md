# Vault du Projet Lumen

## Objet de ce dépôt

Ce dépôt documentaire rassemble les notes, décisions et hypothèses de
l'équipe **Projet Lumen**, qui conçoit une lampe solaire portable
destinée aux zones peu ou pas raccordées au réseau électrique.

Il n'est ni un outil de gestion de projet, ni une base de code : c'est
un **journal de connaissance** au format Markdown, organisé en petits
dossiers thématiques.

## Organisation du dépôt

- `contexte/` — le contexte général du projet.
- `besoins/` — les besoins exprimés par les utilisateurs cibles.
- `cas-usage/` — les scénarios d'usage envisagés.
- `electronique/` — les notes techniques sur l'alimentation et le
  comportement thermique du circuit.
- `finance/` — le positionnement prix et l'analyse de marché.
- `decisions/` — les décisions d'architecture (ADR) qui engagent le
  projet.
- `notes/` — des notes de suivi, y compris des notes qui reviennent
  sur une décision antérieure.
- `hypotheses/` — les hypothèses non vérifiées sur lesquelles
  l'équipe s'appuie provisoirement.
- `glossaire.md` — les définitions des concepts clés du vault.

## Comment lire ce vault

Chaque document porte des titres (`#`, `##`) qui servent de points
d'ancrage : une note peut citer "voir *ADR-001*" ou "voir la section
*Alimentation LED*" et cette citation doit pouvoir être retracée
jusqu'à un fichier et une plage de lignes précise.

Certains mots reviennent dans plusieurs domaines avec un sens
différent — le cas le plus net est **résistance**, qui désigne un
composant électronique dans `electronique/alimentation-led.md` et un
phénomène de marché dans `finance/prix-et-marche.md`. Ce vault a été
écrit pour que ces deux usages ne soient jamais confondus.

Une note (`notes/idee-isolee.md`) est volontairement sans rapport
avec le reste du projet : elle ne doit pas être reliée de force au
graphe de connaissance.
