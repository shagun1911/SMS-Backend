import {
    normalizeFirstNameForUsername,
    phoneSuffixFour,
    buildStudentUsernameBase,
} from '../studentUsername';

describe('studentUsername', () => {
    test('normalizeFirstNameForUsername removes spaces and non-alphanumeric', () => {
        expect(normalizeFirstNameForUsername('  Rahul Kumar ')).toBe('rahulkumar');
        expect(normalizeFirstNameForUsername('Mary-Jane')).toBe('maryjane');
    });

    test('phoneSuffixFour uses last 4 digits', () => {
        expect(phoneSuffixFour('9876543210', 'DPS240001')).toBe('3210');
    });

    test('phoneSuffixFour pads short digit runs', () => {
        expect(phoneSuffixFour('12', 'X')).toBe('0012');
    });

    test('phoneSuffixFour falls back to admission digits', () => {
        expect(phoneSuffixFour('abc', 'DPS240099')).toBe('0099');
    });

    test('buildStudentUsernameBase', () => {
        expect(buildStudentUsernameBase('Rahul', '9876543210', 'DPS240001')).toBe('rahul3210');
        expect(buildStudentUsernameBase('Rahul Kumar', '9876543210', 'DPS240001')).toBe('rahulkumar3210');
    });
});
