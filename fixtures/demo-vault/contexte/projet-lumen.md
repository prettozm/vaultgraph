# Contexte du Projet Lumen

## Origine du projet

Le Projet Lumen est né d'un constat simple : dans de nombreuses
régions rurales, l'accès à un éclairage fiable après le coucher du
soleil reste limité aux lampes à pétrole ou aux téléphones utilisés
en torche. L'équipe s'est donné pour mission de concevoir une lampe
solaire portable, robuste et bon marché, capable de fonctionner de
façon autonome plusieurs jours sans soleil direct.

## Équipe et périmètre

L'équipe rassemble trois profils : un ingénieur électronique, une
responsable produit chargée des besoins utilisateurs, et une
analyste chargée du volet prix et marché. Le périmètre couvre la
conception du circuit d'alimentation, le choix de la batterie, et la
stratégie de mise sur le marché.

## Contraintes générales

Le produit doit rester utilisable par des personnes sans compétence
technique : pas de câblage à réaliser, pas de réglage fin. Il doit
aussi résister à des conditions d'usage difficiles — chaleur,
humidité, chocs de transport — ce qui a des conséquences directes sur
les choix décrits dans `electronique/thermique.md`.

## Lien avec les décisions du projet

Deux décisions structurantes encadrent le projet : le choix de la
technologie de batterie (voir `decisions/ADR-001-batterie.md`, revu
depuis dans `notes/2026-08-changement-batterie.md`) et le
positionnement du prix de lancement (voir
`decisions/ADR-002-prix-de-lancement.md`). Ces décisions reposent en
partie sur des hypothèses encore non vérifiées, listées dans
`hypotheses/hypotheses-ouvertes.md`.

## Ce que ce contexte n'inclut pas

Ce document ne détaille pas les besoins utilisateurs précis (voir
`besoins/utilisateurs.md`) ni les scénarios d'usage concrets (voir
`cas-usage/scenarios.md`), afin de garder une séparation claire entre
le "pourquoi" du projet et ses spécifications.
