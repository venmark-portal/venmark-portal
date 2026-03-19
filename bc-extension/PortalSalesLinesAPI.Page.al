page 50100 "Portal Sales Lines API"
{
    PageType = API;
    APIPublisher = 'venmark';
    APIGroup = 'portal';
    APIVersion = 'v1.0';
    EntityName = 'portalSalesLine';
    EntitySetName = 'portalSalesLines';
    SourceTable = "Sales Line";
    SourceTableView = where("Document Type" = filter(Order));
    ODataKeyFields = SystemId;
    Editable = true;
    InsertAllowed = false;
    DeleteAllowed = false;

    layout
    {
        area(Content)
        {
            repeater(Lines)
            {
                field(id; Rec.SystemId)
                {
                    ApplicationArea = All;
                    Caption = 'id';
                    Editable = false;
                }
                field(documentNo; Rec."Document No.")
                {
                    ApplicationArea = All;
                    Caption = 'documentNo';
                    Editable = false;
                }
                field(lineNo; Rec."Line No.")
                {
                    ApplicationArea = All;
                    Caption = 'lineNo';
                    Editable = false;
                }
                field(lineObjectNumber; Rec."No.")
                {
                    ApplicationArea = All;
                    Caption = 'lineObjectNumber';
                    Editable = true;
                }
                field(description; Rec.Description)
                {
                    ApplicationArea = All;
                    Caption = 'description';
                    Editable = true;
                }
                field(quantity; Rec.Quantity)
                {
                    ApplicationArea = All;
                    Caption = 'quantity';
                    Editable = true;
                }
                field(unitOfMeasureCode; Rec."Unit of Measure Code")
                {
                    ApplicationArea = All;
                    Caption = 'unitOfMeasureCode';
                    Editable = true;
                }
                field(shipQuantity; Rec."Qty. to Ship")
                {
                    ApplicationArea = All;
                    Caption = 'shipQuantity';
                    Editable = true;
                }
                field(unitPrice; Rec."Unit Price")
                {
                    ApplicationArea = All;
                    Caption = 'unitPrice';
                    Editable = true;
                }
                field(portalLineStatus; Rec."Portal Line Status")
                {
                    ApplicationArea = All;
                    Caption = 'portalLineStatus';
                    Editable = true;
                }
                field(portalCustomerNote; Rec."Portal Kundebemærkning")
                {
                    ApplicationArea = All;
                    Caption = 'portalKundebemærkning';
                    Editable = true;
                }
            }
        }
    }
}
