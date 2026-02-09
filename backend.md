# Cloud Functions that we need for the app #

## Add/Delete/Edit Worker Users in Safe way 
* We need function that when the manager wants to add a worker , it adds Authenticated user✅
* We need function that when manager wants to delete a worker , it checks if the worker from the same company and his role is worker based on profile folder in Firebase Cloud Store then it deletes his Authenticated user✅
* We need function that when manager wants to edit worker data , it checks if the worker from the same company and his role is worker based on profile folder in Firebase Cloud Store then it edits authenticated user's email or password based on what the manager added✅

## Tasks Finished

### Add/Delete/Edit Worker Users in Safe way 
* addWorker,editWorker,deleteWorker works perfectly and tested



## Israel Taxes API

* https://github.com/ISRTaxesOpenAPI/-postmanExample

* Token :https://secapp.taxes.gov.il/OpenApiUserGuide/OpenApiUserGuide.pdf

* Document https://www.gov.il/BlobFolder/generalpage/israel-invoice-160723/he/IncomeTax_software-houses-100923.pdf
### Token Generation
#### סוגי השרותים
* שירותים ללא הזדהות ACCESS OPEN
*  הזדהות עם שירותים(ONE TIME/LONG TIME)
* פנייה להפעלת שירות עם הזדהות חייבת להיות מלווה עם TOKEN
 לכל שירות יש תיעוד בפורטל המפתחים איזה סוג TOKEN נדרש להפעלתו (TIME LONG/TIME ONE )

* this is Node js example how to get Token https://github.com/ISRTaxesOpenAPI/nodeJSExample

const axios = require('axios');

//This module is used to get the token from url
module.exports = function  getToken(url,grantType,authCode,tokenRedirectUri,scope,clientID,clientSecret,callback) {
    //Get the authCode
    console.log(url +"/ url"+grantType +"/grantType "+authCode +"/authCode "+tokenRedirectUri +"/tokenRedirectUri "+scope +"/ scope")
    if (authCode == null) {
        console.log('No authCode found');
    }
    else {
        //Send an http post request to get Token 
        axios.post(url,
            {
                "grant_type": grantType,
                "code": authCode,
                "redirect_uri": tokenRedirectUri,
                "scope": scope
            },
            {
                headers: {
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': 'Basic ' + Buffer.from(clientID + ':' + clientSecret).toString('base64')
                }
            })
            .then(function (response) {
                console.log("get token success: "+response);
                return callback(response.data);
            })
            .catch(function (error) {
                console.log("get token error: "+error);
            }
            );
    }
}


### Document Generation


Allocation Number Request – Approval API (Supplier Side / קבלת מספר הקצאה – צד הספק).  
Purpose: Requesting an Allocation Number (מספר הקצאה) from the Israeli Tax Authority is a mandatory condition for VAT input deduction on tax invoices.

Sandbox Endpoint:  
POST https://openapi.taxes.gov.il/shaam/tsandbox/Invoices/v1/Approval

Headers:  
Content-Type: application/json  
Accept: application/json  
Authorization: Bearer <OAuth2 Token>

Main Request Fields (JSON body):

Required fields that we need for json in our case:  
Invoice_ID – unique internal invoice identifier (string).  
Invoice_Type – document type code (number).  
Vat_Number – supplier VAT number (number).  
Invoice_Reference_Num : מספר סידורי
Customer_Name 
Invoice_Date – invoice date (YYYY-MM-DD).  
Invoice_Issuance_Date – issue date, system-generated (YYYY-MM-DD).  
Accounting_Software_Number – accounting software registration number, or 99999999 if not registered (number).  
Amount_Before_Discount
Discount
Payment_Amount – total amount before VAT (number).  
VAT_Amount – VAT amount (number).  
Payment_Amount_Including_VAT – total amount including VAT (number).

Optional Field(we will think about it later)
Items[] – line items (products or services).

Supported Document Types (official codes and Hebrew names as in documentation):

300 – Invoice / Transaction Invoice – חשבונית / חשבונית עסקה – allocation not required.  
305 – Tax Invoice – חשבונית מס – allocation required.  
310 – Consolidated Tax Invoice – חשבונית מס ריכוז – allocation required.  
320 – Tax Invoice + Receipt – חשבונית מס / קבלה – allocation required.  
330 – Tax Credit Invoice – חשבונית מס זיכוי – allocation required.   
332 – Proforma / Transaction Account – חשבון עסקה / פרופורמה – allocation required as pre-approval.

Success response example (allocation approved):  
{
  "Status": 200,
  "Message": "Invoice approved",
  "Confirmation_Number": "2023062805428380179010998"
}

Only the rightmost 9 digits of the allocation number must be printed on the invoice under the Hebrew label “הקצאה מספר:”.

Transaction Invoice (חשבונית עסקה, code 300): Informational document only, does not allow VAT deduction. May receive a pre-approval allocation using document type 332. Must include the note: “לא ניתן לקזז מס תשומות בגין מסמך זה”.

Tax Invoice (חשבונית מס, code 305): Official VAT document, allocation number is mandatory, allows VAT input deduction.

Tax Invoice + Receipt (חשבונית מס / קבלה, code 320): Combined document, allocation number is mandatory.

Tax Credit Invoice (חשבונית מס זיכוי, code 330): Used for refunds or cancellations, amounts are logically negative, allocation number is mandatory.


Response includes supplier and customer details, invoice dates, amounts, VAT values, and line items (Items[]).

Error Response Codes (טבלת קודי שגיאה):

400 Bad Request – Invalid JSON syntax – validate request body.  
401 Unauthorized – Invalid or expired OAuth token – refresh token.  
403 Forbidden – Missing permissions – check service access rights.  
404 Not Found – Invalid endpoint – verify URL.  
406 Not Acceptable – VAT validation issue – verify VAT numbers and permissions.  
422 Unprocessable Entity – Schema validation failed – fix field values according to schema.  
500 Internal Server Error – Server-side error – contact support if persists.

* this is Node js example how to request approval with long time access token
const axios = require('axios');

module.exports = function createRequestWithToken(url,token) {


//send an http post with Authorization header 
  axios.post(url,
  {
    
        "Invoice_ID": "987654321",
        "Vat_Number": 777777715,
        "Invoice_Reference_Number": 975975975,
        "Customer_VAT_Number": 18,
        "Payment_Amount": 10000,
        "VAT_Amount": 1700,
        "Invoice_Sign": 1,
        "Invoice_Type": 1,
        "Invoice_Date": "02/18/2023",
        "Charge_Reversal": 0
      
      //postdata
  },
  {
      headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + token
      }
  })
  .then(function (response) {
    console.dir("api data request succses: "+ response.data)

    return response;
  })
  .catch(function (error) {
      debugger
      console.log("api data request error: "+error);

      if(error.response.status ==403){
          console.log("403")
    }
      if(error.response.status ==401){
          //post with refresh token to get new token 
            console.log("401")
      }
  });
}

* Response Success Approval:
{
 "Status": 200,
 "Message": "Invoice approved",
 "Confirmation_number": "2023062805428380179010998"
}
* if theres any errors we will receive like this response
"Status": 200,
 "Message": [
 {
 "errors": [
 {
 "code": 432,
 "message": "Customer VAT Number is incorrect",
 "param": "Customer_VAT_Number",
 "location": "validation"
 }
 ]
 },
 {
 "errors": [
 {
 "code": 434,
 "message": "Invoice date is more than two weeks
old",
 "param": "Invoice_Date",
 "location": "validation"
 }
 ]
 }
 ],
 "Confirmation_Number": 0


### Invoice Information Retrieval – Invoice Information API (Customer Side / קבלת פרטי חשבונית):  
Sandbox Endpoint:  
POST https://openapi.taxes.gov.il/shaam/tsandbox/invoice-information/v1/details

* same way with the header but the json will contain the confirmation number