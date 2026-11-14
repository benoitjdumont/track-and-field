# Track & Field

<p align="center">
  <strong>Explorez. Enregistrez. Revivez.</strong><br/>
  Une application de suivi GPS pensée pour garder le fil de vos sorties et retrouver les moments qui les rendent mémorables.
</p>

<p align="center">
  <img alt="Android" src="https://img.shields.io/badge/Android-Kotlin%20%7C%20Jetpack%20Compose-3DDC84?logo=android&logoColor=white" />
  <img alt="MapLibre" src="https://img.shields.io/badge/Cartographie-MapLibre-396CB2" />
  <img alt="License" src="https://img.shields.io/badge/Distribution-APK%20gratuit-blue" />
  <img alt="Status" src="https://img.shields.io/badge/Projet-En%20développement-orange" />
</p>

---

## Présentation

**Track & Field** est un projet d'application mobile consacré au suivi de sorties en plein air. L'objectif est simple : enregistrer fidèlement un parcours GPS, puis permettre de le transformer en un récapitulatif visuel où les photos, vidéos et notes retrouveront leur place sur la carte.

Le projet vise les promenades, randonnées, sorties à vélo, moto, gyroroue (EUC), kayak et autres activités de plein air.

L'application est en cours de développement. Cette page distingue volontairement ce qui fonctionne déjà de ce qui est encore prévu.

## Fonctionnalités en cours

- **Suivi GPS Android natif** avec un service de localisation en premier plan.
- **Enregistrement local** des coordonnées du parcours.
- **Statistiques de sortie** : distance, durée, allure moyenne et dénivelé estimé.
- **Carte native MapLibre** avec fond vectoriel OpenFreeMap.
- **Tracé du parcours** affiché sur la carte.
- **Prise en compte des arrêts** : le temps écoulé continue d'être comptabilisé même si les petits déplacements sont filtrés pour éviter les zigzags GPS.

## Une règle essentielle : préserver la vraie sortie

Track & Field doit conserver le parcours réel, sans interrompre automatiquement l'enregistrement lorsqu'on s'arrête à un feu rouge, entre dans un commerce ou reste immobile quelques minutes.

Le projet sépare deux choses :

1. **Le parcours GPS original** : positions et heures réelles, y compris les périodes d'arrêt.
2. **Le futur récapitulatif animé** : lecture plus fluide qui pourra raccourcir les temps d'attente sans déformer le parcours réel.

Les photos, vidéos et notes seront associées à leur position GPS. Dans le récapitulatif, l'animation pourra s'arrêter sur ces souvenirs avant de reprendre le trajet.

## Feuille de route

- [x] Créer une base d'application Android native en Kotlin.
- [x] Intégrer une carte MapLibre et le style vectoriel OpenFreeMap.
- [x] Enregistrer les positions GPS localement.
- [x] Afficher le tracé GPS sur la carte.
- [x] Comptabiliser le temps écoulé pendant les arrêts sans ajouter de points GPS parasites.
- [ ] Renforcer la gestion des états démarrer / pause / terminer et la reprise après interruption du processus.
- [ ] Tester le suivi prolongé sur un téléphone Samsung, écran verrouillé et application en arrière-plan.
- [ ] Ajouter les épingles photo, vidéo et note.
- [ ] Créer les récapitulatifs animés avec compression des périodes d'attente.
- [ ] Ajouter le profil d'altitude et améliorer les statistiques.
- [ ] Étudier les couches satellite, le relief 3D et le mode hors ligne.
- [ ] Ajouter la création, la sauvegarde et le partage des récapitulatifs.

## Télécharger et essayer l'APK Android

Les versions de test sont distribuées gratuitement directement depuis GitHub. Aucune publication sur Google Play n'est nécessaire pour ces essais.

1. Ouvrez la section **Actions** du dépôt.
2. Sélectionnez la dernière exécution réussie de **Build Track & Field Android APK** sur la branche `android/kotlin-native`.
3. Dans **Artifacts**, téléchargez `track-and-field-debug-apk`.
4. Décompressez le fichier ZIP, puis transférez `app-debug.apk` sur votre téléphone Android.
5. Ouvrez l'APK et autorisez l'installation depuis cette source si Android le demande.

[Voir les compilations Android et leurs APK](../../actions/workflows/android-apk.yml)

> Il s'agit actuellement d'une version de développement. Certaines fonctions sont incomplètes et le comportement GPS doit encore être validé sur appareil réel. Les artefacts GitHub Actions sont temporaires et expirent selon la durée de conservation configurée.

## Technologies

| Composant | Technologie |
|---|---|
| Application Android | Kotlin |
| Interface | Jetpack Compose et Material 3 |
| Localisation | Google Play Services Location |
| Cartographie | MapLibre Native Android |
| Fond de carte | OpenFreeMap – style Liberty |
| Compilation | Gradle et GitHub Actions |

Le fond de carte OpenFreeMap utilisé dans la version actuelle est accessible sans clé API. La disponibilité des services cartographiques dépend toutefois de leurs conditions et de leur infrastructure.

## Développement

Le projet Android natif se trouve dans le dossier `track-and-field/`.

La branche de travail Android est :

`android/kotlin-native`

Pour compiler une version de débogage avec Gradle :

```bash
gradle -p track-and-field :app:assembleDebug
```

Le fichier APK est généré dans :

`track-and-field/app/build/outputs/apk/debug/app-debug.apk`

Le workflow GitHub Actions peut aussi être lancé manuellement depuis l'onglet **Actions**.

## Philosophie du projet

- Conserver les données GPS réelles de la sortie.
- Ne jamais confondre un arrêt normal avec une fin d'enregistrement.
- Garder les souvenirs liés à leur emplacement.
- Privilégier des technologies ouvertes et des solutions gratuites lorsque c'est possible.
- Développer progressivement et tester sur de vrais appareils.

---

<p align="center">
  <strong>Track & Field</strong><br/>
  <em>Chaque sortie a son parcours. Chaque parcours a ses souvenirs.</em>
</p>
