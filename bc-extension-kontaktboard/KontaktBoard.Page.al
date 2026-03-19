/// <summary>
/// Venmark Kontaktboard — daglig ringeliste med ordre-status og kontakthandlinger.
/// Filtrerer debitorer baseret på valgt ugedag (default: i dag).
/// </summary>
page 50310 "Venmark Kontakt Board"
{
    ApplicationArea = All;
    Caption = 'Kontaktboard';
    PageType = List;
    SourceTable = Customer;
    UsageCategory = Lists;
    CardPageId = "Customer Card";
    Editable = false;
    RefreshOnActivate = true;

    layout
    {
        area(content)
        {
            // ── Dag-vælger ────────────────────────────────────────────────────
            group(DagVaelger)
            {
                Caption = 'Aktiv dag';
                ShowCaption = false;

                field(AktivDag; AktivDag)
                {
                    ApplicationArea = All;
                    Caption = 'Vis ringeliste for';
                    OptionCaption = 'Mandag,Tirsdag,Onsdag,Torsdag,Fredag';
                    ToolTip = 'Vælg hvilken ugedag ringelisten skal vise. Standard er dags dato.';

                    trigger OnValidate()
                    begin
                        ApplyDayFilter();
                        CurrPage.Update(false);
                    end;
                }
                field(AntalKunder; AntalKunder)
                {
                    ApplicationArea = All;
                    Caption = 'Kunder på listen';
                    Editable = false;
                    Style = Strong;
                }
                field(AntalBestilt; AntalBestilt)
                {
                    ApplicationArea = All;
                    Caption = 'Bestilt i dag';
                    Editable = false;
                    Style = Favorable;
                }
                field(AntalIkkeBestilt; AntalIkkeBestilt)
                {
                    ApplicationArea = All;
                    Caption = 'Ikke bestilt endnu';
                    Editable = false;
                    Style = Unfavorable;
                }
            }

            // ── Kundeliste ────────────────────────────────────────────────────
            repeater(KundeListe)
            {
                field("No."; Rec."No.")
                {
                    ApplicationArea = All;
                    Caption = 'Kundenr.';
                    Width = 6;
                }
                field(Name; Rec.Name)
                {
                    ApplicationArea = All;
                    Caption = 'Navn';
                    Width = 20;
                }
                field("Ringetid"; Rec."Ringetid")
                {
                    ApplicationArea = All;
                    Caption = 'Ringetid';
                    Width = 5;
                }
                field(HarBestiltIDag; HarBestiltIDag)
                {
                    ApplicationArea = All;
                    Caption = 'Bestilt i dag';
                    Width = 7;
                    StyleExpr = BestiltStyle;
                    ToolTip = 'Om kunden har en åben salgsordre oprettet i dag';
                }
                field(OrdreBeloebIDag; OrdreBeloebIDag)
                {
                    ApplicationArea = All;
                    Caption = 'Ordre beløb';
                    Width = 8;
                }
                field("Seneste Ordre Dato"; Rec."Seneste Ordre Dato")
                {
                    ApplicationArea = All;
                    Caption = 'Seneste køb';
                    Width = 7;
                }
                field(DageSidenKoeb; DageSidenKoeb)
                {
                    ApplicationArea = All;
                    Caption = 'Dage siden køb';
                    Width = 6;
                    StyleExpr = DageStyle;
                }
                field("Customer Price Group"; Rec."Customer Price Group")
                {
                    ApplicationArea = All;
                    Caption = 'Prisgruppe';
                    Width = 8;
                }
                field("Kontakt1 Navn"; Rec."Kontakt1 Navn")
                {
                    ApplicationArea = All;
                    Caption = 'Kontakt';
                    Width = 15;
                }
                field("Kontakt1 Mobil"; Rec."Kontakt1 Mobil")
                {
                    ApplicationArea = All;
                    Caption = 'Mobil';
                    Width = 10;
                }
                field("Phone No."; Rec."Phone No.")
                {
                    ApplicationArea = All;
                    Caption = 'Hovednr.';
                    Width = 10;
                }
                field("Kontakt1 Email"; Rec."Kontakt1 Email")
                {
                    ApplicationArea = All;
                    Caption = 'Email';
                    Width = 20;
                }
                field("Portal Aktiv"; Rec."Portal Aktiv")
                {
                    ApplicationArea = All;
                    Caption = 'Portal';
                    Width = 5;
                }
            }
        }

        area(FactBoxes)
        {
            part(KontaktDetaljer; "Venmark Kontakt FactBox")
            {
                ApplicationArea = All;
                SubPageLink = "No." = FIELD("No.");
            }
            systempart(Links; Links) { ApplicationArea = All; }
            systempart(Notes; Notes) { ApplicationArea = All; }
        }
    }

    actions
    {
        area(processing)
        {
            group(KontaktHandlinger)
            {
                Caption = 'Kontakt';
                Image = Contact;

                action(Ring)
                {
                    ApplicationArea = All;
                    Caption = '📞 Ring';
                    ToolTip = 'Ring til kontaktpersonens mobilnummer';
                    Image = Telephone;

                    trigger OnAction()
                    var
                        Mobil: Text;
                    begin
                        Mobil := Rec."Kontakt1 Mobil";
                        if Mobil = '' then
                            Mobil := Rec."Phone No.";
                        if Mobil = '' then begin
                            Message('Ingen mobilnummer registreret på denne kunde.');
                            exit;
                        end;
                        // Fjern mellemrum og +45 prefix
                        Mobil := Mobil.Replace(' ', '').Replace('-', '');
                        if not Mobil.StartsWith('+') then
                            Mobil := '+45' + Mobil;
                        Hyperlink('tel:' + Mobil);
                    end;
                }

                action(SendSMS)
                {
                    ApplicationArea = All;
                    Caption = '💬 SMS';
                    ToolTip = 'Send SMS til kontaktpersonens mobilnummer';
                    Image = SendTo;

                    trigger OnAction()
                    var
                        Mobil: Text;
                    begin
                        Mobil := Rec."Kontakt1 Mobil";
                        if Mobil = '' then begin
                            Message('Ingen mobilnummer registreret på denne kunde.');
                            exit;
                        end;
                        Mobil := Mobil.Replace(' ', '').Replace('-', '');
                        if not Mobil.StartsWith('+') then
                            Mobil := '+45' + Mobil;
                        Hyperlink('sms:' + Mobil);
                    end;
                }

                action(SendEmail)
                {
                    ApplicationArea = All;
                    Caption = '✉️ Email';
                    ToolTip = 'Send email til kontaktpersonen';
                    Image = Email;

                    trigger OnAction()
                    var
                        Email: Text;
                    begin
                        Email := Rec."Kontakt1 Email";
                        if Email = '' then
                            Email := Rec."E-Mail";
                        if Email = '' then begin
                            Message('Ingen email registreret på denne kunde.');
                            exit;
                        end;
                        Hyperlink('mailto:' + Email);
                    end;
                }
            }

            group(OrdreHandlinger)
            {
                Caption = 'Ordre';
                Image = Order;

                action(NySalgsordre)
                {
                    ApplicationArea = All;
                    Caption = '➕ Ny salgsordre';
                    ToolTip = 'Opret ny salgsordre for denne kunde';
                    Image = NewOrder;
                    RunObject = Page "Sales Order";
                    RunPageMode = Create;
                    RunPageLink = "Sell-to Customer No." = FIELD("No.");
                }

                action(SeOrdrer)
                {
                    ApplicationArea = All;
                    Caption = 'Se ordrer';
                    ToolTip = 'Vis åbne salgsordrer for denne kunde';
                    Image = Sales;

                    trigger OnAction()
                    var
                        SalesHdr: Record "Sales Header";
                    begin
                        SalesHdr.SetRange("Sell-to Customer No.", Rec."No.");
                        SalesHdr.SetRange("Document Type", SalesHdr."Document Type"::Order);
                        Page.Run(Page::"Sales Order List", SalesHdr);
                    end;
                }
            }

            group(SyncGrp)
            {
                Caption = 'Portal';

                action(SyncTilPortal)
                {
                    ApplicationArea = All;
                    Caption = 'Sync til Portal';
                    Image = Export;
                    ToolTip = 'Opretter/opdaterer kunden i bestillingsportalen';

                    trigger OnAction()
                    var
                        SyncMgt: Codeunit "Venmark Portal Sync";
                    begin
                        SyncMgt.SyncCustomer(Rec);
                    end;
                }
            }
        }

        area(navigation)
        {
            action(GaaTilDebitor)
            {
                ApplicationArea = All;
                Caption = 'Åbn debitorkort';
                Image = Customer;
                RunObject = Page "Customer Card";
                RunPageLink = "No." = FIELD("No.");
            }
        }
    }

    // ── Variabler ─────────────────────────────────────────────────────────────
    var
        AktivDag:         Option Mandag,Tirsdag,Onsdag,Torsdag,Fredag;
        HarBestiltIDag:   Boolean;
        OrdreBeloebIDag:  Decimal;
        DageSidenKoeb:    Integer;
        BestiltStyle:     Text;
        DageStyle:        Text;
        AntalKunder:      Integer;
        AntalBestilt:     Integer;
        AntalIkkeBestilt: Integer;

    // ── Triggers ──────────────────────────────────────────────────────────────
    trigger OnOpenPage()
    var
        WeekDay: Integer;
    begin
        // Default til aktuel ugedag (1=Mandag, 2=Tirsdag, ... 5=Fredag)
        WeekDay := Date2DWY(Today, 1);
        case WeekDay of
            1: AktivDag := AktivDag::Mandag;
            2: AktivDag := AktivDag::Tirsdag;
            3: AktivDag := AktivDag::Onsdag;
            4: AktivDag := AktivDag::Torsdag;
            5: AktivDag := AktivDag::Fredag;
            else
                AktivDag := AktivDag::Mandag; // Weekend → vis mandag
        end;
        ApplyDayFilter();
    end;

    trigger OnAfterGetRecord()
    var
        SalesHdr: Record "Sales Header";
        SalesInvHdr: Record "Sales Invoice Header";
    begin
        // Har kunden en åben ordre oprettet i dag?
        SalesHdr.SetRange("Sell-to Customer No.", Rec."No.");
        SalesHdr.SetRange("Document Type", SalesHdr."Document Type"::Order);
        SalesHdr.SetRange("Order Date", Today);
        HarBestiltIDag := not SalesHdr.IsEmpty();

        // Ordre-beløb i dag (sum af alle åbne ordrer oprettet i dag)
        OrdreBeloebIDag := 0;
        if SalesHdr.FindSet() then
            repeat
                SalesHdr.CalcFields("Amount Including VAT");
                OrdreBeloebIDag += SalesHdr."Amount Including VAT";
            until SalesHdr.Next() = 0;

        // Dage siden seneste bogførte faktura
        Rec.CalcFields("Seneste Ordre Dato");
        if Rec."Seneste Ordre Dato" <> 0D then
            DageSidenKoeb := Today - Rec."Seneste Ordre Dato"
        else
            DageSidenKoeb := 9999;

        // Styling
        if HarBestiltIDag then
            BestiltStyle := 'Favorable'
        else
            BestiltStyle := 'Unfavorable';

        if DageSidenKoeb > 30 then
            DageStyle := 'Unfavorable'
        else if DageSidenKoeb > 14 then
            DageStyle := 'Ambiguous'
        else
            DageStyle := 'Favorable';
    end;

    trigger OnAfterGetCurrRecord()
    begin
        UpdateSummary();
    end;

    // ── Lokale procedurer ─────────────────────────────────────────────────────
    local procedure ApplyDayFilter()
    begin
        Rec.Reset();
        case AktivDag of
            AktivDag::Mandag:
                Rec.SetRange("Ringe Mandag", true);
            AktivDag::Tirsdag:
                Rec.SetRange("Ringe Tirsdag", true);
            AktivDag::Onsdag:
                Rec.SetRange("Ringe Onsdag", true);
            AktivDag::Torsdag:
                Rec.SetRange("Ringe Torsdag", true);
            AktivDag::Fredag:
                Rec.SetRange("Ringe Fredag", true);
        end;
        UpdateSummary();
    end;

    local procedure UpdateSummary()
    var
        TmpCust: Record Customer;
        SalesHdr: Record "Sales Header";
    begin
        AntalKunder := 0;
        AntalBestilt := 0;

        TmpCust.CopyFilters(Rec);
        AntalKunder := TmpCust.Count();

        // Tæl kunder med ordre i dag
        if TmpCust.FindSet() then
            repeat
                SalesHdr.SetRange("Sell-to Customer No.", TmpCust."No.");
                SalesHdr.SetRange("Document Type", SalesHdr."Document Type"::Order);
                SalesHdr.SetRange("Order Date", Today);
                if not SalesHdr.IsEmpty() then
                    AntalBestilt += 1;
            until TmpCust.Next() = 0;

        AntalIkkeBestilt := AntalKunder - AntalBestilt;
    end;
}
