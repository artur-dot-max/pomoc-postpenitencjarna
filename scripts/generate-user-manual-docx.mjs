import fs from "node:fs";
import path from "node:path";

const outPath = path.resolve("Instrukcja_uzytkownika_pomoc_postpenitencjarna.docx");

function escapeXml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) {
    crc ^= byte;
    for (let i = 0; i < 8; i += 1) {
      crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function dosDateTime(date = new Date()) {
  const year = Math.max(date.getFullYear(), 1980);
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2);
  const dosDate = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return { dosTime, dosDate };
}

function u16(value) {
  const buffer = Buffer.alloc(2);
  buffer.writeUInt16LE(value);
  return buffer;
}

function u32(value) {
  const buffer = Buffer.alloc(4);
  buffer.writeUInt32LE(value >>> 0);
  return buffer;
}

function createZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;
  const { dosTime, dosDate } = dosDateTime();

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const crc = crc32(data);

    const localHeader = Buffer.concat([
      u32(0x04034b50),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      name,
    ]);
    localParts.push(localHeader, data);

    const centralHeader = Buffer.concat([
      u32(0x02014b50),
      u16(20),
      u16(20),
      u16(0x0800),
      u16(0),
      u16(dosTime),
      u16(dosDate),
      u32(crc),
      u32(data.length),
      u32(data.length),
      u16(name.length),
      u16(0),
      u16(0),
      u16(0),
      u16(0),
      u32(0),
      u32(offset),
      name,
    ]);
    centralParts.push(centralHeader);
    offset += localHeader.length + data.length;
  }

  const central = Buffer.concat(centralParts);
  const end = Buffer.concat([
    u32(0x06054b50),
    u16(0),
    u16(0),
    u16(files.length),
    u16(files.length),
    u32(central.length),
    u32(offset),
    u16(0),
  ]);

  return Buffer.concat([...localParts, central, end]);
}

function paragraph(text, style = "Normal") {
  const styleTag = style === "Normal" ? "" : `<w:pPr><w:pStyle w:val="${style}"/></w:pPr>`;
  return `<w:p>${styleTag}<w:r><w:t xml:space="preserve">${escapeXml(text)}</w:t></w:r></w:p>`;
}

function bullet(text) {
  return paragraph(`• ${text}`);
}

function spacer() {
  return `<w:p/>`;
}

const blocks = [];
const p = (text, style) => blocks.push(paragraph(text, style));
const b = (text) => blocks.push(bullet(text));
const br = () => blocks.push(spacer());

p("Instrukcja użytkownika", "Title");
p("Program: Wykaz osób - Pomoc Postpenitencjarna", "Subtitle");
p("Dokument opisuje codzienną pracę z aplikacją, pierwsze uruchomienie, prowadzenie ewidencji, raportowanie, przenoszenie bazy danych oraz podstawowe zasady bezpieczeństwa.", "Normal");
br();

p("1. Informacje ogólne", "Heading1");
p("Aplikacja służy do lokalnej ewidencji osób uprawnionych do pomocy postpenitencjarnej, rejestrowania udzielonej pomocy, prowadzenia listy pracowników oraz przygotowywania raportów i miesięcznych wykazów.", "Normal");
p("Program działa jako aplikacja offline. Dane są przechowywane lokalnie na komputerze użytkownika, w lokalnej bazie SQLite. Oznacza to, że aplikacja nie synchronizuje danych automatycznie przez internet i nie przenosi bazy samodzielnie między komputerami.", "Normal");
b("Każda umowa może mieć osobną bazę danych.");
b("Aktywna umowa jest widoczna w aplikacji jako aktualnie wybrana baza umowy.");
b("Za wykonywanie kopii bezpieczeństwa i ręczne przenoszenie bazy odpowiada użytkownik lub administrator organizacji.");
br();

p("2. Pierwsze uruchomienie", "Heading1");
p("Przy pierwszym uruchomieniu na danym komputerze aplikacja wymaga aktywacji licencji. Aktywacja jest wykonywana tylko raz na tym komputerze, chyba że aplikacja zostanie zainstalowana ponownie albo dane aplikacji zostaną usunięte.", "Normal");
p("Kroki pierwszego uruchomienia:", "Heading2");
b("Uruchom aplikację.");
b("Na ekranie Aktywacja licencji wpisz otrzymany klucz licencji w polu Klucz licencji.");
b("Kliknij Aktywuj.");
b("Po poprawnym wpisaniu klucza aplikacja poprosi o podanie numeru umowy.");
b("Wpisz numer umowy dokładnie w takiej postaci, w jakiej ma pojawiać się w raportach i nazwach plików.");
b("Potwierdź zapis numeru umowy.");
b("Po aktywacji pojawi się ekran logowania.");
p("Jeżeli nie posiadasz klucza licencji, skontaktuj się z opiekunem albo z pomocą wskazaną na ekranie aktywacji. W aplikacji podane są numery telefonów: 22-23-90-505, 22-23-90-700, 539-521-634 oraz adres e-mail DFN.wsparcie@ms.gov.pl.", "Normal");
br();

p("3. Logowanie", "Heading1");
p("Po aktywacji dostępny jest ekran Logowanie. Należy podać login i hasło użytkownika.", "Normal");
p("Domyślnie aplikacja tworzy konta startowe:", "Normal");
b("admin - konto administratora, pełny dostęp do aplikacji.");
b("pracownik - konto pracownika, dostęp do pracy operacyjnej zgodnie z uprawnieniami.");
p("Po pierwszym zalogowaniu zaleca się zmianę haseł domyślnych i uzupełnienie danych pracowników. Administrator powinien dopilnować, aby w projekcie nie używać jednego wspólnego konta dla wielu osób.", "Normal");
br();

p("4. Role użytkowników", "Heading1");
b("Administrator - pełny dostęp, zarządzanie pracownikami, hasłami, danymi organizacji, raportami i bazami.");
b("Pracownik - wprowadzanie i edycja danych oraz praca z raportami w zakresie przewidzianym przez aplikację.");
b("Tylko odczyt - podgląd danych bez wykonywania zmian operacyjnych.");
p("Rola powinna odpowiadać realnemu zakresowi obowiązków osoby. Nie należy nadawać uprawnień administratora osobom, które nie muszą zarządzać kontami i danymi technicznymi.", "Normal");
br();

p("5. Odzyskiwanie hasła", "Heading1");
p("Jeżeli użytkownik nie pamięta hasła, na ekranie logowania należy kliknąć Odzyskaj hasło. Aplikacja przejdzie do ekranu Odzyskiwanie hasła.", "Normal");
p("Procedura odzyskiwania:", "Heading2");
b("Skontaktuj się z pomocą wskazaną na ekranie: telefonicznie lub mailowo pod adresem DFN.wsparcie@ms.gov.pl.");
b("Uzyskaj kod resetu hasła.");
b("Wpisz kod w polu Kod resetu.");
b("Kliknij Potwierdź kod.");
b("Po potwierdzeniu kodu aplikacja wróci do logowania i pokaże formularz resetu.");
b("Wpisz login użytkownika, nowe hasło oraz powtórzenie nowego hasła.");
b("Kliknij Zapisz nowe hasło.");
p("Kod resetu jest przeznaczony do jednorazowego użycia. Jeżeli aplikacja poinformuje, że kod został już wykorzystany, należy ponownie skontaktować się z pomocą.", "Normal");
br();

p("6. Uzupełnienie danych organizacji", "Heading1");
p("Dane organizacji są używane w raportach, nazwach plików i informacjach identyfikujących umowę. Po pierwszym uruchomieniu administrator powinien wejść w Dane organizacji i uzupełnić formularz.", "Normal");
p("Do uzupełnienia są w szczególności:", "Normal");
b("Nazwa organizacji.");
b("Nazwa Ośrodka.");
b("Nr umowy.");
b("Imię i nazwisko osoby do kontaktu.");
b("Nr telefonu.");
b("Adres e-mail.");
p("Po wpisaniu danych kliknij Zapisz dane. Jeżeli dane są zablokowane do odczytu, kliknij Edytuj dane, wprowadź poprawki i zapisz.", "Normal");
br();

p("7. Obsługa baz umów", "Heading1");
p("W sekcji Dane organizacji znajduje się obszar Bazy umów. Służy on do pracy na oddzielnych bazach danych dla różnych umów.", "Normal");
b("Aktywna umowa pokazuje, z której bazy obecnie korzystasz.");
b("Aby utworzyć nową bazę dla umowy, wpisz numer nowej umowy i kliknij Utwórz nową bazę umowy.");
b("Po potwierdzeniu aplikacja tworzy osobną bazę i przełącza się na nią.");
b("Na liście umów można przełączać się między bazami.");
b("Usunięcie bazy umowy usuwa lokalny plik bazy danych. Tej operacji nie należy wykonywać bez aktualnej kopii bezpieczeństwa.");
p("Przed przełączaniem lub usuwaniem baz upewnij się, że pracujesz na właściwej umowie. Dane wpisane do jednej bazy nie pojawią się automatycznie w innej bazie.", "Normal");
br();

p("8. Obowiązek wpisania pracowników projektu", "Heading1");
p("Administrator ma obowiązek wpisać w aplikacji wszystkich pracowników, którzy są uwzględnieni w projekcie i którzy mogą być wykazywani jako osoby udzielające pomocy albo pracujące z danymi.", "Normal");
p("Jest to ważne, ponieważ:", "Normal");
b("wpis pomocy zawiera pole osoby udzielającej pomocy;");
b("raport Aktywność pracowników opiera się na danych pracowników;");
b("każdy użytkownik powinien pracować na własnym koncie;");
b("indywidualne konta ułatwiają kontrolę dostępu i ograniczają ryzyko błędów.");
p("Nie należy wpisywać pomocy na fikcyjnego, wspólnego albo nieaktualnego pracownika. Jeżeli osoba przestaje pracować przy projekcie, administrator powinien wyłączyć jej konto albo zmienić zakres dostępu.", "Normal");
br();

p("9. Utworzenie konta użytkownika", "Heading1");
p("Konta tworzy administrator w sekcji Pracownicy. Na stronie głównej kliknij Pracownicy, a następnie użyj formularza Dodaj/edytuj pracownika.", "Normal");
p("Tworzenie nowego pracownika:", "Heading2");
b("W polu Pracownik do edycji wybierz opcję nowego pracownika, jeżeli jest dostępna.");
b("Wpisz imię, nazwisko i stanowisko.");
b("Wybierz rolę: Pracownik, Administrator albo Tylko odczyt.");
b("Wpisz hasło dla nowego konta.");
b("Kliknij Zapisz pracownika.");
b("Aplikacja nada login automatycznie na podstawie imienia i nazwiska.");
p("Edycja istniejącego pracownika:", "Heading2");
b("Wybierz pracownika z listy.");
b("Zmień imię, nazwisko, stanowisko lub rolę.");
b("Pole hasła jest przy edycji opcjonalne. Wypełnij je tylko wtedy, gdy chcesz ustawić nowe hasło.");
b("Kliknij Zapisz pracownika.");
p("Administrator może też zmieniać hasła użytkowników w sekcji Zmień hasło. Pracownik, który nie jest administratorem, w widoku Moje dane może zmienić swoje dane i własne hasło.", "Normal");
br();

p("10. Wpis osoby uprawnionej", "Heading1");
p("Nową osobę dodaje się na stronie głównej w sekcji Dane osoby uprawnionej. Kliknij panel, aby rozwinąć formularz.", "Normal");
p("Najważniejsze pola:", "Heading2");
b("Nr wniosku i Data wniosku.");
b("Oznaczenie osoby uprawnionej.");
b("Informacja o zgodzie na przedłużenie pomocy do 12 miesięcy, jeżeli dotyczy.");
b("Informacja, czy udzielono pomocy korespondencyjnej.");
b("Imię, nazwisko, obywatelstwo, PESEL lub dokument tożsamości.");
b("Status UKR, data urodzenia, telefon, e-mail, płeć i adres.");
b("Stan cywilny, niepełnosprawność, środki posiadane w dniu zwolnienia.");
b("Zakład karny lub areszt śledczy, data osadzenia, data zwolnienia.");
b("Źródło informacji o pomocy i opis potrzebnej pomocy.");
p("Pola oznaczone gwiazdką są wymagane. Aplikacja sprawdza poprawność PESEL i zakres dat. Po wypełnieniu formularza zapisz osobę. Dodana osoba pojawi się na liście osób.", "Normal");
p("Lista osób pozwala wyszukiwać po nazwisku i PESEL. Z listy można przejść do karty osoby, gdzie widoczne są szczegóły oraz historia udzielonej pomocy.", "Normal");
br();

p("11. Wpis pomocy na karcie osoby", "Heading1");
p("Aby dopisać pomoc konkretnej osobie, otwórz jej kartę z listy osób i kliknij Dodaj wpis w sekcji Udzielona pomoc.", "Normal");
p("W formularzu wpisu pomocy uzupełnij:", "Normal");
b("Datę udzielonej pomocy.");
b("Rodzaj wsparcia.");
b("Kwotę.");
b("Ilość.");
b("Osobę udzielającą pomocy.");
b("Opcjonalną notatkę.");
p("Kwota i ilość służą do wyliczeń raportowych. Jeżeli wpisujesz pomoc rzeczową albo usługę, ilość powinna odzwierciedlać rzeczywistą liczbę świadczeń lub jednostek zgodnie z przyjętą ewidencją.", "Normal");
p("Dla wybranych kategorii osób aplikacja pilnuje, aby data udzielonej pomocy mieściła się w okresie uprawnienia liczonym od daty zwolnienia. Jeżeli data jest poza dozwolonym zakresem, wpis nie zostanie zapisany.", "Normal");
br();

p("12. Wpis pomocy współdzielonej", "Heading1");
p("Na stronie głównej dostępny jest panel Wpis pomocy współdzielonej. Służy on do wpisania jednego zdarzenia pomocy dla wielu osób jednocześnie.", "Normal");
p("Typowy sposób użycia:", "Heading2");
b("Rozwiń panel Wpis pomocy współdzielonej.");
b("Wybierz rodzaj wsparcia.");
b("Wpisz datę udzielonej pomocy i datę wpisu, jeżeli pole jest dostępne.");
b("Wpisz kwotę i ilość.");
b("Wybierz osoby z listy. Możesz filtrować po imieniu, nazwisku lub PESEL.");
b("Sprawdź podsumowanie: łączna kwota, liczba osób i kwota przypadająca na osobę.");
b("Wpisz notatkę, jeżeli jest potrzebna.");
b("Zapisz wpis.");
p("Aplikacja dopisze pomoc do kart wszystkich zaznaczonych osób. Przy takim wpisie notatka otrzymuje automatyczną adnotację, że pochodzi z pomocy współdzielonej, z informacją o łącznej kwocie, liczbie osób i kwocie na osobę.", "Normal");
br();

p("13. Raporty", "Heading1");
p("Raporty są dostępne po kliknięciu Raporty na stronie głównej. Zakres raportu dotyczy daty udzielenia pomocy.", "Normal");
p("Podstawowa procedura:", "Heading2");
b("Wpisz Data od i Data do.");
b("Zaznacz rodzaj raportu: Miesięczny wg zadań, Osoby i udzielona pomoc, Aktywność pracowników albo Wszystkie dane.");
b("Wybierz format: CSV albo Excel.");
b("Kliknij Generuj.");
b("Wskaż miejsce zapisania pliku, jeżeli aplikacja o to poprosi.");
p("Przycisk Wszystkie dane zaznacza/generuje pełny zestaw raportowy. Raport Wszystkie dane (baza) zawiera szczegółowe informacje, w tym wpisy pomocy i notatki.", "Normal");
p("Przed wygenerowaniem raportu upewnij się, że zakres dat odpowiada okresowi sprawozdawczemu oraz że dane organizacji i numer umowy są uzupełnione.", "Normal");
br();

p("14. Pobieranie i przenoszenie bazy danych na inny komputer", "Heading1");
p("Aplikacja działa offline. Dane nie przenoszą się automatycznie między komputerami. Jeżeli baza ma być używana na innym komputerze, trzeba ręcznie wykonać eksport bazy, przenieść plik i zaimportować go w drugiej instalacji programu.", "Normal");
p("Eksport bazy:", "Heading2");
b("Wejdź w Raporty.");
b("W sekcji Pobieranie kopii bazy danych kliknij Eksport bazy (.db) albo wybierz archiwum RAR/7z.");
b("Wskaż miejsce zapisu pliku.");
b("Zachowaj plik w bezpiecznym miejscu, np. na zaszyfrowanym nośniku lub w zabezpieczonym katalogu.");
p("Import bazy na innym komputerze:", "Heading2");
b("Zainstaluj i uruchom aplikację na drugim komputerze.");
b("Aktywuj licencję, jeżeli jest to pierwsze uruchomienie.");
b("Wejdź w Raporty.");
b("Kliknij Import bazy (.db).");
b("Wybierz plik bazy przeniesiony z poprzedniego komputera.");
b("Wybierz tryb importu: Dopisz do bazy albo Podmień bazę.");
b("Potwierdź import i sprawdź raport importu.");
p("Tryb Dopisz do bazy zachowuje istniejące dane i próbuje dopisać brakujące rekordy. Tryb Podmień bazę zastępuje dane w aktualnej bazie danymi z importowanego pliku. Przed użyciem trybu Podmień bazę wykonaj kopię aktualnej bazy.", "Normal");
br();

p("15. Comiesięczny wykaz do Ministerstwa", "Heading1");
p("Aplikacja przypomina na stronie głównej, że do 10 dnia każdego miesiąca należy przesłać miesięczny wykaz osób do Ministerstwa.", "Normal");
p("Do przygotowania pliku służy przycisk Pobierz bazę i zaszyfruj do wysyłki do Ministerstwa w sekcji Raporty -> Pobieranie kopii bazy danych.", "Normal");
p("Jak działa przycisk:", "Heading2");
b("Aplikacja tworzy spójną migawkę aktualnie wybranej bazy danych.");
b("Baza jest szyfrowana na potrzeby wysyłki.");
b("Następnie aplikacja przygotowuje archiwum do przekazania, zależnie od dostępnych narzędzi i wybranego formatu.");
b("Po utworzeniu pliku aplikacja pokazuje komunikat z informacją, że dane zostały przygotowane do wysyłki.");
p("Utworzenie pliku nie oznacza jego automatycznej wysyłki. Po zapisaniu pliku użytkownik musi samodzielnie wysłać go przez e-Doręczenia na właściwy adres wskazany przez Ministerstwo. W aplikacji komunikat po przygotowaniu paczki wskazuje adres e-Doręczeń: AE:PL-45507-58621-HRWWR-20.", "Normal");
p("Przed wysyłką sprawdź, czy pracujesz na właściwej aktywnej umowie oraz czy dane za raportowany miesiąc są kompletne.", "Normal");
br();

p("16. Import i eksport a bezpieczeństwo", "Heading1");
p("Pliki bazy danych i raporty mogą zawierać dane osobowe oraz dane wrażliwe dotyczące korzystania z pomocy. Należy traktować je jako materiały poufne.", "Normal");
b("Nie wysyłaj plików bazy zwykłym e-mailem, jeżeli nie zostało to wyraźnie dopuszczone przez procedury organizacji.");
b("Do przenoszenia używaj nośników zabezpieczonych hasłem lub szyfrowaniem.");
b("Po imporcie usuń tymczasowe kopie z pulpitu, folderu Pobrane i nośników przenośnych, jeżeli nie są już potrzebne.");
b("Nie zostawiaj kopii bazy na komputerach prywatnych lub współdzielonych.");
b("Przechowuj kopie zapasowe zgodnie z zasadami obowiązującymi w organizacji.");
br();

p("17. Zasady przetwarzania danych", "Heading1");
p("W aplikacji są przetwarzane dane osobowe osób uprawnionych, pracowników oraz informacje o udzielonej pomocy. Użytkownicy powinni przetwarzać dane wyłącznie w zakresie niezbędnym do realizacji zadań projektu i zgodnie z obowiązującymi procedurami organizacji.", "Normal");
p("Podstawowe zasady:", "Heading2");
b("Wprowadzaj tylko dane potrzebne do obsługi osoby, ewidencji pomocy i sprawozdawczości.");
b("Dbaj o poprawność danych: imiona, nazwiska, PESEL, daty, kwoty, rodzaje pomocy i numer umowy powinny być weryfikowane przed zapisem.");
b("Nie wpisuj informacji nadmiarowych w notatkach. Notatka powinna być rzeczowa, krótka i związana z udzieloną pomocą.");
b("Nie udostępniaj danych osobom, które nie są uprawnione do pracy przy projekcie.");
b("Raporty i eksporty traktuj tak samo jak bazę danych, ponieważ również mogą zawierać dane osobowe.");
b("Jeżeli zauważysz błąd w danych, popraw go możliwie szybko albo zgłoś administratorowi.");
b("Jeżeli dojdzie do utraty pliku, nieuprawnionego dostępu lub wysłania danych do niewłaściwego adresata, zgłoś incydent zgodnie z procedurą organizacji.");
br();

p("18. Dobre zasady bezpieczeństwa danych", "Heading1");
b("Każdy użytkownik powinien pracować na własnym koncie.");
b("Nie udostępniaj loginu ani hasła innym osobom.");
b("Hasło powinno być unikalne i trudne do odgadnięcia.");
b("Zmieniaj hasło po podejrzeniu, że mogło zostać ujawnione.");
b("Nie zapisuj haseł na kartkach przy komputerze ani w niezaszyfrowanych plikach.");
b("Blokuj komputer, gdy odchodzisz od stanowiska.");
b("Nie zostawiaj otwartej aplikacji bez nadzoru.");
b("Regularnie wykonuj kopie bazy danych.");
b("Przechowuj kopie w miejscu zabezpieczonym przed przypadkowym usunięciem i dostępem osób nieuprawnionych.");
b("Przed większym importem, podmianą bazy lub usunięciem bazy umowy wykonaj dodatkową kopię.");
b("Aktualizuj system operacyjny i program antywirusowy zgodnie z zasadami organizacji.");
b("Nie instaluj narzędzi RAR/7z z nieznanych źródeł.");
b("Wysyłając plik do Ministerstwa, upewnij się, że wybierasz właściwy plik, właściwą umowę i właściwy adres e-Doręczeń.");
br();

p("19. Zalecana kolejność konfiguracji po instalacji", "Heading1");
b("Aktywuj licencję.");
b("Wpisz numer umowy.");
b("Zaloguj się jako administrator.");
b("Zmień hasło administratora.");
b("Uzupełnij dane organizacji.");
b("Wpisz wszystkich pracowników projektu i nadaj im właściwe role.");
b("Utwórz lub sprawdź bazę właściwej umowy.");
b("Wprowadź osoby uprawnione.");
b("Rejestruj pomoc na kartach osób albo przez wpis pomocy współdzielonej.");
b("Regularnie generuj raporty i wykonuj kopie bazy.");
b("Co miesiąc przygotuj zaszyfrowany plik do Ministerstwa i wyślij go ręcznie przez e-Doręczenia.");
br();

p("20. Najczęstsze problemy", "Heading1");
p("Nie mogę się zalogować.", "Heading2");
b("Sprawdź login i hasło. Jeżeli hasło jest nieznane, użyj Odzyskaj hasło albo poproś administratora o ustawienie nowego hasła.");
p("Nie widzę opcji zarządzania pracownikami.", "Heading2");
b("Prawdopodobnie nie jesteś zalogowany jako administrator. Tylko administrator zarządza kontami pracowników.");
p("Raport nie zawiera oczekiwanych danych.", "Heading2");
b("Sprawdź zakres dat. Zakres raportu dotyczy daty udzielenia pomocy. Sprawdź też, czy pracujesz na właściwej aktywnej umowie.");
p("Nie mogę utworzyć archiwum RAR albo 7z.", "Heading2");
b("Do tworzenia archiwów wymagane jest zainstalowane narzędzie systemowe WinRAR/RAR albo 7-Zip.");
p("Dane nie pojawiły się na drugim komputerze.", "Heading2");
b("Aplikacja jest offline. Trzeba ręcznie wyeksportować bazę na pierwszym komputerze i zaimportować ją na drugim.");

const documentXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    ${blocks.join("\n")}
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838"/>
      <w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440" w:header="708" w:footer="708" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>`;

const stylesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:style w:type="paragraph" w:default="1" w:styleId="Normal">
    <w:name w:val="Normal"/>
    <w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/></w:pPr>
    <w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Title">
    <w:name w:val="Title"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="240"/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="44"/><w:color w:val="1F4E3D"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Subtitle">
    <w:name w:val="Subtitle"/>
    <w:basedOn w:val="Normal"/>
    <w:pPr><w:spacing w:after="320"/></w:pPr>
    <w:rPr><w:sz w:val="28"/><w:color w:val="5A5F5A"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading1">
    <w:name w:val="heading 1"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr><w:spacing w:before="360" w:after="160"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="32"/><w:color w:val="1F4E3D"/></w:rPr>
  </w:style>
  <w:style w:type="paragraph" w:styleId="Heading2">
    <w:name w:val="heading 2"/>
    <w:basedOn w:val="Normal"/>
    <w:next w:val="Normal"/>
    <w:pPr><w:spacing w:before="220" w:after="120"/><w:keepNext/></w:pPr>
    <w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="2F6B4F"/></w:rPr>
  </w:style>
</w:styles>`;

const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>
  <Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>
  <Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/>
</Types>`;

const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/>
</Relationships>`;

const documentRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

const created = new Date().toISOString();
const coreXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <dc:title>Instrukcja użytkownika - Pomoc Postpenitencjarna</dc:title>
  <dc:creator>Codex</dc:creator>
  <cp:lastModifiedBy>Codex</cp:lastModifiedBy>
  <dcterms:created xsi:type="dcterms:W3CDTF">${created}</dcterms:created>
  <dcterms:modified xsi:type="dcterms:W3CDTF">${created}</dcterms:modified>
</cp:coreProperties>`;

const appXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes">
  <Application>Microsoft Word</Application>
</Properties>`;

const zip = createZip([
  { name: "[Content_Types].xml", data: contentTypesXml },
  { name: "_rels/.rels", data: relsXml },
  { name: "word/document.xml", data: documentXml },
  { name: "word/styles.xml", data: stylesXml },
  { name: "word/_rels/document.xml.rels", data: documentRelsXml },
  { name: "docProps/core.xml", data: coreXml },
  { name: "docProps/app.xml", data: appXml },
]);

fs.writeFileSync(outPath, zip);
console.log(outPath);
