/**
 * Converts a number to Indian Rupees in words (e.g. 5000 -> "Five Thousand Rupees Only")
 */
const ones = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine'];
const tens = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
const teens = ['Ten', 'Eleven', 'Twelve', 'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];

function convertLessThanThousand(n: number): string {
    if (n === 0) return '';
    let result = '';
    if (n >= 100) {
        result += ones[Math.floor(n / 100)] + ' Hundred ';
        n %= 100;
    }
    if (n >= 20) {
        result += tens[Math.floor(n / 10)] + ' ';
        n %= 10;
    } else if (n >= 10) {
        result += teens[n - 10] + ' ';
        return result.trim();
    }
    if (n > 0) result += ones[n] + ' ';
    return result.trim();
}

export function numberToWords(num: number): string {
    if (num === 0) return 'Zero Rupees Only';
    const intPart = Math.floor(num);
    if (intPart < 0) return 'Invalid';
    if (intPart === 0) return 'Zero Rupees Only';

    const crore = Math.floor(intPart / 10000000);
    const lakh = Math.floor((intPart % 10000000) / 100000);
    const thousand = Math.floor((intPart % 100000) / 1000);
    const hundred = intPart % 1000;

    let result = '';
    if (crore > 0) result += convertLessThanThousand(crore) + ' Crore ';
    if (lakh > 0) result += convertLessThanThousand(lakh) + ' Lakh ';
    if (thousand > 0) result += convertLessThanThousand(thousand) + ' Thousand ';
    if (hundred > 0) result += convertLessThanThousand(hundred) + ' ';

    return (result.trim() + ' Rupees Only').replace(/\s+/g, ' ');
}
