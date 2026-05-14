# PROJECT LOG

## Cel pliku

Ten plik sluzy do szybkiego zapoznania sie z projektem oraz do raportowania wszystkich zmian w kodzie wprowadzanych w kolejnych zadaniach.

Przy kazdej nastepnej zmianie w kodzie ten plik powinien zostac uzupelniony o:
- zakres zmiany,
- zmienione obszary aplikacji,
- krotki opis skutku biznesowego lub technicznego,
- informacje o weryfikacji, jesli byla wykonana.

## O projekcie

Nazwa projektu: `pomoc-postpenitencjarna`

Typ aplikacji:
- desktopowa aplikacja Tauri 2,
- frontend oparty o Vite + TypeScript,
- lokalna baza danych SQLite.

Glowny cel aplikacji:
- obsluga danych osob uprawnionych do pomocy postpenitencjarnej,
- ewidencja udzielonej pomocy,
- zarzadzanie uzytkownikami i rolami,
- raportowanie,
- import, eksport i backup baz danych,
- obsluga osobnych baz danych dla roznych umow.

## Glowne obszary systemu

- `login.html` i `recover.html`: logowanie, aktywacja licencji, odzyskiwanie hasla.
- `index.html`: glowny formularz i lista osob.
- `detail.html`: szczegoly osoby i historia udzielonej pomocy.
- `organization.html`: dane organizacji i konfiguracja umow.
- `reports.html`: generowanie raportow i operacje import/eksport.
- `workers.html`: zarzadzanie pracownikami i danymi kont.
- `src/main.ts`: glowna logika frontendu i znaczna czesc logiki aplikacyjnej.
- `src-tauri/src/main.rs`: komendy Tauri dla operacji systemowych, licencji, importu/eksportu i backupow.

## Dane i mechanizmy

Najwazniejsze elementy danych:
- `authorized_persons`,
- `person_help_entries`,
- `users`,
- `organization_settings`.

Wazne mechanizmy:
- aktywacja licencji na podstawie klucza,
- reset hasla przy pomocy kodu recovery,
- eksport bazy do pliku,
- szyfrowany backup,
- tworzenie oddzielnych baz danych dla poszczegolnych umow.

## Historia zmian

### 2026-05-13

#### Dodanie wpisów pomocy z poziomu strony głównej
- Na stronie głównej dodano dwa zwijane panele: `Wpis pomocy współdzielonej` oraz `Wpis pomocy niepodzielnej`.
- Wpis pomocy współdzielonej pozwala wybrać rodzaj wsparcia, datę udzielonej pomocy, datę wpisu, kwotę, ilość oraz wiele osób z listy.
- Aplikacja wylicza łączną kwotę, liczbę zaznaczonych osób i kwotę przypadającą na osobę.
- Po zapisie pomoc współdzielona jest automatycznie dopisywana do kart zaznaczonych osób jako wpisy w `person_help_entries`.
- Dodano zapis pomocy niepodzielnej do osobnej tabeli `indivisible_help_entries`, wraz z listą ostatnich wpisów na stronie głównej.
- Dla pomocy niepodzielnej zapis obejmuje kod i pełną etykietę wybranego rodzaju wsparcia.
- Ujednolicono katalog rodzajów wsparcia dla formularza na karcie osoby i formularza pomocy współdzielonej.
- Weryfikacja: uruchomiono `npm run build`; build zakończył się powodzeniem.

#### Walidacja daty udzielonej pomocy względem okresu uprawnienia
- Usunięto blokadę dodawania osoby opartą o bieżącą datę po upływie okresu pomocy.
- Dodano walidację przy zapisie pomocy: dla osób z ograniczonym okresem wsparcia data udzielonej pomocy musi mieścić się od daty zwolnienia do daty końca okresu pomocy.
- Zasada działa dla wpisu pomocy na karcie osoby oraz dla wpisu pomocy współdzielonej z poziomu strony głównej.
- Skutek: można wprowadzać dane historyczne, jeśli sama data udzielonej pomocy mieści się w okresie uprawnienia.
- Weryfikacja: uruchomiono `npm run build`; build zakończył się powodzeniem.

#### Odświeżenie okresu udzielania pomocy po edycji dat osoby
- Po zapisie edycji karty osoby aplikacja ponownie odczytuje rekord z bazy i renderuje szczegóły z aktualnych danych.
- Dzięki temu zmiana daty zwolnienia lub zgody na przedłużenie pomocy od razu aktualizuje informację `Okres udzielania pomocy kończy się dnia`.
- Po odświeżeniu danych aktualizowany jest również stan używany przy walidacji daty wpisu pomocy.
- Weryfikacja: uruchomiono `npm run build`; build zakończył się powodzeniem.

#### Nazwa pliku bazy wewnątrz archiwów RAR i 7Z
- Zmieniono nazewnictwo eksportu bazy danych na format `NR_UMOWY_BAZA_DANYCH_MIESIAC_ROK`.
- Przy tworzeniu hasłowanych archiwów RAR i 7Z backend tworzy migawkę bazy pod nazwą przekazaną z frontendu, zamiast technicznej nazwy `export-snapshot-...db`.
- Skutek: wewnątrz archiwum znajduje się plik `.db` z nazwą biznesową, np. `NR_UMOWY_BAZA_DANYCH_KWIECIEN_2026.db`.
- Weryfikacja: uruchomiono `npm run build` oraz `cargo check`; oba polecenia zakończyły się powodzeniem.

#### Filtrowanie listy osób przy pomocy współdzielonej
- W panelu `Wpis pomocy współdzielonej` dodano wyszukiwanie osób po imieniu/nazwisku oraz PESEL.
- Dodano licznik zaznaczonych osób i przycisk czyszczenia zaznaczeń.
- Zaznaczone osoby pozostają zaznaczone podczas filtrowania listy.
- Dodano paginację listy osób po 5 osób na stronę.
- Weryfikacja: uruchomiono `npm run build`; build zakończył się powodzeniem.

#### Paginacja głównej listy osób
- Do sekcji `Lista osób` na stronie głównej dodano paginację po 20 osób na stronę.
- Filtry po nazwisku i PESEL działają przed podziałem wyników na strony.
- Dodano przyciski `Poprzednia` i `Następna` oraz informację o aktualnej stronie.
- Weryfikacja: uruchomiono `npm run build`; build zakończył się powodzeniem.

#### Ukrycie technicznych nazw baz w widoku umów
- W sekcji `Dane organizacji` -> `Bazy umów` usunięto z widoku nazwy plików baz danych.
- Lista pokazuje teraz numer umowy oraz dane organizacji/ośrodka, a ścieżka bazy pozostaje tylko w technicznym atrybucie potrzebnym do przełączania i usuwania umów.
- Weryfikacja: uruchomiono `npm run build`; build zakończył się powodzeniem.

### 2026-03-31

#### Utworzenie pliku operacyjnego
- Dodano plik `PROJECT_LOG.md`.
- Zapisano skrocony opis celu aplikacji, architektury i glownych modulow.
- Ustalono, ze kolejne zmiany w kodzie beda tutaj dopisywane jako rejestr zmian.

#### Automatyczne nazewnictwo plikow eksportu w raportach
- Zmieniono domyslne nazwy plikow przy eksporcie raportow oraz bazy danych w sekcji raportow.
- Nowy format nazwy opiera sie o schemat: `NR_UMOWY_WYKAZ_OSOB_MIESIAC_WCZESNIEJSZY`.
- Numer umowy jest pobierany z danych organizacji, a nazwa miesiaca wyliczana automatycznie jako poprzedni miesiac wzgledem aktualnej daty.
- Zmiana obejmuje eksport raportow `CSV` i `XLSX`, eksport bazy `DB`, szyfrowany eksport `ENC` oraz archiwa `RAR` i `7Z`.
- Weryfikacja: zmiana wykonana w logice generowania domyslnej nazwy pliku w `src/main.ts`.

#### Poprawka wyliczania poprzedniego miesiaca
- Naprawiono blad dla dat konca miesiaca, np. `31 marca`, gdzie nazwa pliku mogla nadal pokazywac `MARZEC` zamiast `LUTY`.
- Zmieniono sposob liczenia poprzedniego miesiaca tak, aby najpierw ustawic pierwszy dzien biezacego miesiaca, a dopiero potem cofnac miesiac.
- Skutek: dla daty w marcu domyslna nazwa eksportu wskazuje `LUTY`, zgodnie z wymaganiem.

#### Dodanie roku do nazwy pliku eksportu
- Rozszerzono format domyslnej nazwy pliku o rok poprzedniego miesiaca.
- Aktualny schemat nazwy to: `NR_UMOWY_WYKAZ_OSOB_MIESIAC_ROK`.
- Przyklad dla daty `2026-03-31`: `NR_UMOWY_WYKAZ_OSOB_LUTY_2026`.

#### Szybka weryfikacja builda po zmianach
- Po zmianach uruchomiono szybkie sprawdzenie `npm run build`.
- Pierwszy build wykryl blad TypeScript: nieuzywana funkcja `timestampForFileName` w `src/main.ts`.
- Usunieto nieuzywany fragment kodu.
- Ponowny build zakonczyl sie powodzeniem.

#### Eksport do Ministerstwa jako archiwum zamiast pliku `.enc`
- Zmieniono dzialanie przycisku `Pobierz baze i zaszyfruj do wysylki do Ministerstwa`.
- Zamiast zapisywac bezposrednio plik `.enc`, aplikacja szyfruje baze do pliku tymczasowego `.enc`, a nastepnie automatycznie pakuje go do archiwum `RAR` albo `7Z`.
- Format archiwum jest wybierany na podstawie rozszerzenia wskazanego przy zapisie pliku; domyslnie proponowany jest plik `7Z`.
- Po poprawnym przygotowaniu paczki aplikacja wyswietla komunikat:
- `Dane zostaly przygotowane do wysylki. Prosze o wysylke pliku na adres eDoreczen: AE:PL-45507-58621-HRWWR-20`
- Dodano nowa komende backendowa w Tauri do przygotowania zaszyfrowanego archiwum na potrzeby wysylki.
- Weryfikacja: po wdrozeniu uruchomiono `npm run build`; pierwszy build wykryl nieuzywany typ `EncryptedBackupResult`, po usunieciu typu ponowny build zakonczyl sie powodzeniem.

#### Poprawka importu bazy w trybie `Dopisz do bazy`
- Naprawiono problem, w ktorym import w trybie `Dopisz do bazy` mogl konczyc sie bledem, mimo ze tryb `Podmien baze` dzialal poprawnie.
- Przyczyna: podczas dopisywania import probowal ponownie wstawic osoby o tym samym `person_uuid`, co powodowalo konflikt unikalnosci.
- Nowe zachowanie: jesli osoba o tym samym `person_uuid` juz istnieje w bazie docelowej, import wykorzystuje istniejacy rekord zamiast tworzyc duplikat.
- Dodatkowo frontend pokazuje teraz bardziej szczegolowy komunikat bledu importu zamiast stalego ogolnego komunikatu.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Doprecyzowanie raportu importu i oddzielne okno podsumowania
- Rozszerzono wynik importu o liczbe `Pominieto duplikaty osob`.
- Zmieniono raport po imporcie tak, aby pokazywal:
- `Dodano osob`
- `Pominieto duplikaty osob`
- `Dodano wpisow pomocy`
- `Pominieto duplikaty pomocy`
- `Dodano kont uzytkownikow`
- Po udanym imporcie raport wyswietla sie teraz w oddzielnym oknie dialogowym, zamiast tylko w krotkim komunikacie na stronie.
- Dodano style UI dla okna podsumowania importu.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Usuniecie etykiet `Tak` i `Nie` z przelacznika trybu importu
- Usunieto dodatkowe napisy `Tak` i `Nie` wyswietlane przy przelaczniku `Dopisz do bazy / Podmien baze`.
- Zmiana zostala ograniczona tylko do przelacznika trybu importu, bez ingerencji w pozostale przelaczniki aplikacji.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Korekta selektora CSS dla przelacznika trybu importu
- Poprawiono selektor CSS odpowiedzialny za ukrycie napisu `Tak` w aktywnym stanie przelacznika importu.
- Przyczyna: poprzedni selektor nie trafial poprawnie w wariant `checked`.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Wyroznienie przycisku eksportu do Ministerstwa
- Wyrózniono przycisk `Pobierz baze i zaszyfruj do wysylki do Ministerstwa`, aby byl bardziej widoczny od pozostalych akcji w sekcji raportow.
- Dodano osobna klase i mocniejszy styl wizualny: pelne tlo, wyzszy kontrast i wyrazniejszy cien.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Przypomnienie o miesiecznym wykazie osob na stronie glownej
- Dodano przypomnienie na stronie glownej, wyswietlane pod logo Funduszu.
- Komunikat pojawia sie tylko miedzy 5. a 10. dniem kazdego miesiaca.
- Komunikat zostal wyrozniony czerwonym stylem, aby byl wyraznie widoczny.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Dodanie pola `Nr wniosku` do danych osoby uprawnionej
- Dodano pole `Nr wniosku` na poczatek formularza `Dane osoby uprawnionej`.
- Pole zostalo podpiete end-to-end: zapis do bazy, odczyt z bazy, edycja oraz wyswietlanie w karcie osoby.
- Rozszerzono obsluge schematu SQLite po stronie frontendu i backendu Tauri, tak aby starsze bazy byly automatycznie uzupelniane o nowa kolumne `request_number`.
- Rozszerzono logike importu baz danych, aby pole `Nr wniosku` bylo przenoszone razem z rekordami osob.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Zmiana tekstu potwierdzenia przy tworzeniu nowej bazy umowy
- Rozszerzono wspolny modal potwierdzenia o mozliwosc ustawienia wlasnego tekstu przycisku zatwierdzajacego i anulowania.
- Dla akcji tworzenia nowej bazy umowy zmieniono tekst przycisku potwierdzenia z `Usuń` na `Tak, utwórz nową bazę danych`.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Zmiana tekstu potwierdzenia przy przelaczaniu bazy umowy
- Dla akcji przelaczania aplikacji na inna baze umowy zmieniono tekst przycisku potwierdzenia z `Usuń` na `Tak, przełącz`.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Delikatne podswietlenie aktywnej bazy umowy
- Aktywna baza na liscie umow zostala wyrozniona delikatnym zielonym akcentem.
- Zmiana obejmuje subtelne zielone tlo, jasniejsza ramke oraz boczny zielony akcent dla aktywnego wiersza.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Korekta tla aktywnej bazy umowy
- Wzmocniono efekt wyroznienia aktywnej bazy, ustawiajac wyrazniejsze jasnozielone tlo calego wiersza.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Filtry `Udzielonej pomocy` na karcie osoby
- W widoku `Karta osoby uprawnionej` dodano filtry w sekcji `Udzielona pomoc`.
- Dostepne tryby filtrowania:
- `Za cały okres`
- `Dany miesiąc`
- Dla trybu `Dany miesiąc` dodano wybor miesiaca, a tabela pomocy filtruje wpisy bezposrednio na poziomie zapytania SQL.
- Po zmianie filtra, usunieciu wpisu lub zapisaniu wpisu tabela zachowuje aktualny zakres filtrowania.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Recovery code jako jednorazowy globalnie
- Zmieniono mechanizm recovery code tak, aby kod resetu hasla byl jednorazowy globalnie dla calej aplikacji, a nie osobno dla kazdej bazy umowy.
- Zuzyte kody sa teraz zapisywane we wspolnym rejestrze aplikacji w katalogu danych aplikacji.
- Skutek: recovery code wykorzystany raz nie moze zostac ponownie uzyty przy innej bazie danych ani dla innej aktywnej umowy.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Aktualizacja danych kontaktowych na ekranie odzyskiwania hasla
- Zmieniono tresc instrukcji na ekranie odzyskiwania hasla.
- Dodano nowe numery telefonu:
- `22-23-90-505`
- `22-23-90-700`
- `539-521-634`
- Numery telefonow sa wyswietlane jeden pod drugim.
- Zmieniono adres e-mail kontaktowy na `DFN.wsparcie@ms.gov.pl`.
- Przy okazji odtworzono plik `recover.html` w poprawnym kodowaniu UTF-8.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Wymuszenie podania numeru umowy po wpisaniu klucza licencji
- Po wpisaniu klucza licencji aplikacja otwiera teraz osobne okno dialogowe z wymuszeniem podania `Nr umowy`.
- Bez podania numeru umowy aktywacja licencji nie jest kontynuowana.
- Po poprawnej aktywacji numer umowy jest od razu zapisywany do `organization_settings` aktywnej bazy danych.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Aktualizacja instrukcji na ekranie aktywacji licencji
- Zmieniono tekst informacyjny na ekranie aktywacji licencji.
- Dodano informację o kontakcie z Opiekunem oraz nowe dane kontaktowe awaryjne.
- Numery telefonow wyswietlane sa jeden pod drugim:
- `22-23-90-505`
- `22-23-90-700`
- `539-521-634`
- Zmieniono adres e-mail kontaktowy na `DFN.wsparcie@ms.gov.pl`.
- Przy okazji odtworzono plik `login.html` w poprawnym kodowaniu UTF-8.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.

#### Spójny snapshot SQLite przy eksporcie bazy danych
- Sprawdzono mechanizm eksportu bazy danych i stwierdzono, ze proste kopiowanie pliku `app.db` nie daje pelnej gwarancji spójnego zrzutu w trakcie pracy aplikacji.
- Zmieniono eksport bazy oraz powiazane eksporty backupow tak, aby przed zapisaniem tworzyly spójna migawke SQLite przez `VACUUM INTO`.
- Zmiana obejmuje eksport `DB`, eksport `base64`, backup szyfrowany, eksport do Ministerstwa oraz archiwa `RAR` i `7Z`.
- Skutek: eksport obejmuje caly spójny stan danych z chwili wywolania eksportu.
- Weryfikacja: po zmianie uruchomiono `npm run build`; build zakonczyl sie powodzeniem.
