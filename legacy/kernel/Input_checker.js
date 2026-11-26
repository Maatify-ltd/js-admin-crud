
// Regular expressions
const REGEX = {
	EMPTY: /\s/g,
	CODE: />|<|'|"|,|;/g,
	NUMBER: /^\d+$/,
	SLUG_URL: /^[a-z\/0-9\-]+$/,
	NUMBER_FLOAT: /^\d+(\.\d+)?$/,
	PHONE: /^\+?[1-9]\d{1,14}$/,
	FLOAT: /^[+-]?\d+(\.\d+)?$/,
	EMAIL: /^(([^<>()\[\]\\.,;:\s@"]+(\.[^<>()\[\]\\.,;:\s@"]+)*)|(".+"))@((\[[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\.[0-9]{1,3}\])|(([a-zA-Z\-0-9]+\.)+[a-zA-Z]{2,}))$/
};

/**
 * Escape a value before it is interpolated into generated markup.
 * Prefixed name: this file runs in the global scope and pages declare their own
 * escapeHtml, so a bare `const escapeHtml` here would collide with a page's
 * `function escapeHtml` and kill the page with a SyntaxError.
 */
function inputCheckerEscapeHtml(value) {
	if (value === null || value === undefined) return '';
	return String(value)
		.replace(/&/g, '&amp;')
		.replace(/</g, '&lt;')
		.replace(/>/g, '&gt;')
		.replace(/"/g, '&quot;')
		.replace(/'/g, '&#039;');
}

// Helper functions
// `message` is built from DOM attributes the page author controls (placeholder,
// select-title), and `item.id` from the element id. Both are read back decoded and
// re-inserted through insertAdjacentHTML, so both are escaped here.
const createErrorMessage = (item, message) => { 

	item.querySelectorAll(".input-error")?.forEach((icon) => icon.remove());
	const errorIcon = `<i class="fa-solid error-icon fa-circle-xmark"></i>`;
	return `<p class="text-red-500 text-sm input-error" id="${inputCheckerEscapeHtml(item.id)}-error">
    ${errorIcon}
    ${inputCheckerEscapeHtml(message)}
  </p>`;
};

const handleValidationUI = (element, isValid, errorMessage = "", parentElement = null) => {
	const target = parentElement || element;
	const messageElement = target.nextElementSibling;
	if (!isValid) {
		element.style.borderColor = "var(--color-danger)";
		if (!messageElement?.classList.contains("input-error")) {
			target.insertAdjacentHTML("afterend", errorMessage);
		}
		return false;
	} else {
		if (messageElement?.classList.contains("input-error")) {
			element.style.borderColor = "var(--color-border)";
			messageElement.remove();
		}
		return true;
	}
};

 function checkRegCode(values) {
	REGEX.CODE.lastIndex = 0;
	return values.every((item) => {
		const isValid = !REGEX.CODE.test(item.value);
		return handleValidationUI(item, isValid, createErrorMessage(item, `make sure you write ${item.placeholder} correctly`));
	});
}

//  function checkRegCodeAndEmpty(values) {
// 	const errors = [];
// 	REGEX.CODE.lastIndex = 0;
// 	const result = values.every((item) => {
// 		const isValid = !(item.value === "" || REGEX.CODE.test(item.value) || !/\S/.test(item.value));
// 		if (!isValid) errors.push(item.placeholder);
// 		return handleValidationUI(item, isValid, createErrorMessage(item, `make sure you write ${item.placeholder} correctly`));
// 	});
//
// 	return errors.length === 0 && result;
// }

 function checkRegCodeAndEmpty(values) {
	const errors = [];
	REGEX.CODE.lastIndex = 0;
	let allValid = true;

	values.forEach((item) => {
		const isValid = !(item.value === "" || REGEX.CODE.test(item.value) || !/\S/.test(item.value));
		if (!isValid) {
			errors.push(item.placeholder);
			allValid = false;
		}
		handleValidationUI(item, isValid, createErrorMessage(item, `make sure you write ${item.placeholder} correctly`));
	});

	return errors.length === 0 && allValid;
}
//  function checkRegSelect(values) {
// 	const errors = [];
//
// 	const result = values.every((item) => {
// 		console.log(item)
// 		const isValid = item.value !== "" && item.value !== null;
// 		if (!isValid) errors.push(item.getAttribute("select-title"));
//
// 		return handleValidationUI(item, isValid, createErrorMessage(item, `make sure you select ${item.getAttribute("select-title")} correctly`));
// 	});
//
// 	return errors.length === 0 && result;
// }
 function checkRegSelect(values) {
	const errors = [];

	values.forEach((item) => {
		const isValid = item.value !== "" && item.value !== null;
		if (!isValid) errors.push(item.getAttribute("select-title"));

		handleValidationUI(
			item,
			isValid,
			createErrorMessage(item, `make sure you select ${item.getAttribute("select-title")} correctly`)
		);
	});

	return errors.length === 0;
}

 function checkRegSelect2(values) {
	const errors = [];

	const result = values.every((item) => {
		const valueId = item.getAttribute("value-id");
		const isValid = valueId !== "" ;
		if (!isValid) errors.push(item.getAttribute("select-title"));

		return handleValidationUI(item.parentElement, isValid, createErrorMessage(item, ""), item.parentElement.parentElement);
	});

	return errors.length === 0 && result;
}

 function checkRegEmail(values) {
	console.log(values)
	REGEX.EMAIL.lastIndex = 0;
	return values.every((item) => {
		const isValid = item.value != null && REGEX.EMAIL.test(item.value);
		return handleValidationUI(item, isValid, createErrorMessage(item, `make sure you write ${item.placeholder} correctly`));
	});
}

 function checkRegPhone(values) {
	try {
		return values.every((item) => {
			const value = item.value.replaceAll(" ", "");
			const isValid = REGEX.PHONE.test(value) && /\S/.test(value);

			return handleValidationUI(item, isValid, createErrorMessage(item, `make sure you write ${item.placeholder} correctly`), item);
		});
	} catch (e) {
		console.error(e);
		return false;
	}
}

 function checkRegNumberAndEmptyAndFloat(values) {
	try {
		return values.every((item) => {
			const isValid = item.value != null && REGEX.NUMBER_FLOAT.test(item.value) && /\S/.test(item.value);
			return handleValidationUI(item, isValid, createErrorMessage(item, `make sure you write ${item.placeholder} correctly`), item.parentElement);
		});
	} catch (e) {
		console.error(e);
		return false;
	}
}
